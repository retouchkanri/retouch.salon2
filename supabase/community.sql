-- =====================================================================
-- Retouch 会員専用コミュニティ（Slack 風チャット）
--
--   チャンネル（公開／非公開・対象者別）、運営と会員／会員同士のダイレクト
--   メッセージ、スレッド、リアクション、ピン留め、既読・未読、通報、利用停止、
--   添付ファイル、リアルタイム配信（Supabase Realtime）を提供する。
--
-- 適用方法: Supabase ダッシュボード → SQL Editor にこのファイルの全文を貼り付けて Run。
-- 冪等（何度実行しても同じ状態になる）。適用済みの環境で再実行すると最新の関数・ポリシーに
-- 更新される（既存のメッセージ・チャンネルなどのデータは変更しない）。
-- （customers / profiles / contracts / membership_plans / support_subscriptions /
--   special_team_memberships / app_settings は参照のみ）。
--
-- セキュリティ方針:
--   - 閲覧は RLS（行レベルセキュリティ）で制御する。会員は「参加資格のあるチャンネル」
--     と「自分が参加している DM」だけを読める。運営も他人同士の DM は読めない。
--   - 書き込みはすべて SECURITY DEFINER の関数（community_send など）経由のみ。
--     テーブルへの直接の INSERT / UPDATE / DELETE は authenticated / anon に許可しない。
--   - Slack の1つのワークスペースと同じく、有効な会員はいつでも参加できる（管理画面での
--     「公開」操作は不要）。会員どうしでも公開／非公開チャンネルを作成できる。
--   - 他の会員には本名を出さず、コミュニティ用の表示名だけを表示する（本名は運営のみ）。
-- =====================================================================

create extension if not exists "pgcrypto";

-- =====================================================================
-- テーブル
-- =====================================================================

-- ---------- コミュニティ用プロフィール（表示名など） ----------
create table if not exists public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text
    check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  bio text check (bio is null or char_length(bio) <= 300),
  avatar_url text,
  is_staff boolean not null default false,
  -- 会員同士のダイレクトメッセージを受け付けるか（運営からの DM は常に受け付ける）
  allow_dm boolean not null default true,
  -- 表示名の初期設定を済ませたか
  setup_done boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- アクティビティ（メンション・スレッド返信）を最後に確認した日時
alter table public.community_profiles add column if not exists activity_seen_at timestamptz;

-- ---------- コミュニティで表示しないアカウント（動作確認用のテストアカウントなど） ----------
-- ここに登録したユーザーはメンバー一覧・メンバー数・DM の宛先検索・@メンション候補・招待候補に出ない。
-- ログインやコミュニティの利用自体はそのまま可能（投稿済みのメッセージには名前が表示される）。
create table if not exists public.community_hidden_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- チャンネル／ダイレクトメッセージ ----------
create table if not exists public.community_channels (
  id uuid primary key default gen_random_uuid(),
  -- channel: チャンネル / dm: ダイレクトメッセージ（1対1）
  kind text not null default 'channel' check (kind in ('channel', 'dm')),
  name text,
  description text check (description is null or char_length(description) <= 500),
  topic text check (topic is null or char_length(topic) <= 200),
  -- 表示用の分類（一般・お知らせ・イベント・馬の近況・支援者・会員ランク・運営・その他）
  category text not null default 'general'
    check (category in ('general', 'announcement', 'event', 'horse', 'supporters', 'rank', 'staff', 'other')),
  -- public: 参加資格のある人が一覧から閲覧・参加できる / private: 招待されたメンバーのみ
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  -- 参加資格（public のとき有効）
  --   all: 全会員 / plans: 指定の会員種別（ランク） / supporters: 指定馬の支援者 / staff: 運営のみ
  audience text not null default 'all' check (audience in ('all', 'plans', 'supporters', 'staff')),
  -- plans のときの会員種別コード: A B C OWNER SUPPORT RPT SPECIAL_TEAM FREE
  audience_plan_codes text[] not null default '{}',
  -- supporters のときの馬（空 = いずれかの馬を支援中の会員）
  audience_horse_ids uuid[] not null default '{}',
  -- everyone: 誰でも投稿 / staff: 運営のみ新規投稿（会員はスレッド返信・リアクションのみ）
  post_policy text not null default 'everyone' check (post_policy in ('everyone', 'staff')),
  -- 参加資格のある全員のサイドバーに自動で表示するか
  auto_join boolean not null default true,
  -- 退出不可（全員必須のチャンネル）
  is_required boolean not null default false,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  -- DM の重複防止キー（2人のユーザーIDを昇順に ':' で連結）
  dm_key text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_channels_name_chk
    check (kind = 'dm' or (name is not null and char_length(btrim(name)) between 1 and 60)),
  constraint community_channels_dm_chk
    check (kind = 'channel' or dm_key is not null)
);

-- チャンネルのアイコン（VPS に保存した画像のパス /uploads/... または絵文字1つ。null = # / 鍵のマーク）
alter table public.community_channels add column if not exists icon text
  check (icon is null or char_length(icon) <= 300);

create unique index if not exists community_channels_name_uidx
  on public.community_channels (lower(name)) where kind = 'channel';
create index if not exists community_channels_kind_idx
  on public.community_channels (kind, sort_order);

-- ---------- チャンネルごとの参加状態・既読位置 ----------
--   DM: 参加者2人分の行。hidden = 会話を閉じた（新着で自動的に再表示）
--   非公開チャンネル: 行がある = メンバー
--   公開チャンネル: 行が無ければ auto_join に従う。hidden = 退出（または未参加のまま閲覧）
create table if not exists public.community_channel_members (
  channel_id uuid not null references public.community_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  -- 通知: all / mentions / none（null = 既定: DM とお知らせ系は all、その他は mentions）
  notify text check (notify is null or notify in ('all', 'mentions', 'none')),
  is_starred boolean not null default false,
  hidden boolean not null default false,
  primary key (channel_id, user_id)
);

create index if not exists community_channel_members_user_idx
  on public.community_channel_members (user_id);

-- ---------- メッセージ（スレッド返信を含む） ----------
create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.community_channels(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  -- スレッドの親（null = チャンネル直下の投稿）
  parent_id uuid references public.community_messages(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  -- [{ path, name, type, size }]（Storage の非公開バケット community 内のパス）
  attachments jsonb not null default '[]'::jsonb,
  mentions uuid[] not null default '{}',
  -- @channel（運営のみ）
  mention_channel boolean not null default false,
  -- { "👍": ["user-id", ...], ... }
  reactions jsonb not null default '{}'::jsonb,
  reply_count integer not null default 0,
  last_reply_at timestamptz,
  last_reply_user_id uuid,
  reply_user_ids uuid[] not null default '{}',
  is_pinned boolean not null default false,
  pinned_by uuid,
  pinned_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists community_messages_channel_idx
  on public.community_messages (channel_id, created_at desc) where parent_id is null;
create index if not exists community_messages_thread_idx
  on public.community_messages (parent_id, created_at) where parent_id is not null;
create index if not exists community_messages_user_idx
  on public.community_messages (user_id, created_at desc);
create index if not exists community_messages_pinned_idx
  on public.community_messages (channel_id) where is_pinned;
-- アクティビティ（自分へのメンション・参加したスレッド）の検索用
create index if not exists community_messages_mentions_idx
  on public.community_messages using gin (mentions);
create index if not exists community_messages_reply_users_idx
  on public.community_messages using gin (reply_user_ids) where parent_id is null;
-- 会員が作成したチャンネル数の制限（連続作成の防止）用
create index if not exists community_channels_created_by_idx
  on public.community_channels (created_by, created_at) where kind = 'channel';

-- ---------- 利用停止 ----------
create table if not exists public.community_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  -- null = 無期限
  until timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 通報 ----------
create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.community_messages(id) on delete set null,
  channel_id uuid references public.community_channels(id) on delete set null,
  reporter_id uuid references auth.users(id) on delete set null,
  reported_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  -- 通報時点の本文（後で削除・編集されても確認できるように）
  message_body text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists community_reports_status_idx
  on public.community_reports (status, created_at desc);

-- ---------- updated_at の自動更新 ----------
create or replace function public.community__touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists community_channels_touch on public.community_channels;
create trigger community_channels_touch
  before update on public.community_channels
  for each row execute function public.community__touch_updated_at();

drop trigger if exists community_profiles_touch on public.community_profiles;
create trigger community_profiles_touch
  before update on public.community_profiles
  for each row execute function public.community__touch_updated_at();

-- =====================================================================
-- 判定用の内部関数（authenticated / anon からは直接呼べない）
-- =====================================================================

-- 旧バージョンの「会員に公開」設定（互換のため残す。参加の判定には使わない）
create or replace function public.community_is_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select lower(btrim(s.value)) = 'true' from public.app_settings s where s.key = 'community.enabled'),
    false
  );
$$;

-- 運営（owner / admin / moderator）か。public.is_admin() と同じ判定を任意のユーザーに対して行う。
create or replace function public.community__is_staff(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (
    select 1 from public.profiles p
    where p.id = p_user and p.role in ('owner', 'admin', 'moderator')
  );
$$;

create or replace function public.community__is_banned(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and exists (
    select 1 from public.community_bans b
    where b.user_id = p_user and (b.until is null or b.until > now())
  );
$$;

-- 有効な会員（退会・停止・登録途中は除く）の顧客ID
create or replace function public.community__customer_id(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.customers c
  where p_user is not null
    and (
      c.auth_user_id = p_user
      or c.id = (select p.customer_id from public.profiles p where p.id = p_user)
    )
    and c.status = 'active'
    and c.registration_completed is not false
  order by (c.auth_user_id = p_user) desc nulls last, c.created_at
  limit 1;
$$;

-- コミュニティを利用できるアカウントか（公開状態は問わない）
create or replace function public.community__is_active_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and (
    public.community__is_staff(p_user)
    or (
      not public.community__is_banned(p_user)
      and public.community__customer_id(p_user) is not null
    )
  );
$$;

-- 現在コミュニティに入れるか（運営、または利用停止中でない有効な会員。公開操作は不要）
create or replace function public.community__is_member(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null and public.community__is_active_user(p_user);
$$;

-- 会員種別（ランク）コード。契約中のプラン + 支援中なら SUPPORT + 特別チームなら SPECIAL_TEAM。
-- 何も無ければ FREE（無料会員）。決済失敗中（past_due）も会員として扱う。
create or replace function public.community__member_codes(p_user uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer uuid := public.community__customer_id(p_user);
  v_codes text[];
begin
  if v_customer is null then
    return '{}'::text[];
  end if;

  select coalesce(array_agg(distinct mp.code::text), '{}'::text[])
    into v_codes
  from public.contracts ct
  join public.membership_plans mp on mp.id = ct.plan_id
  where ct.customer_id = v_customer
    and ct.status in ('active', 'past_due');

  if exists (
    select 1 from public.support_subscriptions s
    where s.customer_id = v_customer and s.status in ('active', 'past_due')
  ) and not ('SUPPORT' = any(v_codes)) then
    v_codes := array_append(v_codes, 'SUPPORT');
  end if;

  if exists (
    select 1 from public.special_team_memberships t
    where t.customer_id = v_customer and t.status in ('active', 'past_due')
  ) and not ('SPECIAL_TEAM' = any(v_codes)) then
    v_codes := array_append(v_codes, 'SPECIAL_TEAM');
  end if;

  if cardinality(v_codes) = 0 then
    v_codes := array['FREE'];
  end if;
  return v_codes;
end;
$$;

-- 支援中（一口支援・特別チーム）の馬
create or replace function public.community__supported_horses(p_user uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with cust as (select public.community__customer_id(p_user) as id)
  select coalesce(array_agg(distinct x.horse_id), '{}'::uuid[])
  from (
    select s.horse_id
    from public.support_subscriptions s, cust
    where s.customer_id = cust.id and s.status in ('active', 'past_due') and s.horse_id is not null
    union
    select t.horse_id
    from public.special_team_memberships t, cust
    where t.customer_id = cust.id and t.status in ('active', 'past_due') and t.horse_id is not null
  ) x;
$$;

-- 公開チャンネルの参加資格（利用停止・公開状態はここでは見ない）
create or replace function public.community__eligible(
  p_user uuid,
  p_audience text,
  p_codes text[],
  p_horses uuid[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_horses uuid[];
begin
  if p_user is null then
    return false;
  end if;
  if public.community__is_staff(p_user) then
    return true;
  end if;
  if p_audience = 'staff' then
    return false;
  end if;
  if public.community__customer_id(p_user) is null then
    return false;
  end if;

  if p_audience = 'all' then
    return true;
  elsif p_audience = 'plans' then
    return coalesce(p_codes, '{}'::text[]) && public.community__member_codes(p_user);
  elsif p_audience = 'supporters' then
    v_horses := public.community__supported_horses(p_user);
    return cardinality(v_horses) > 0
      and (cardinality(coalesce(p_horses, '{}'::uuid[])) = 0 or v_horses && p_horses);
  end if;
  return false;
end;
$$;

-- チャンネル（または DM）を読めるか
create or replace function public.community__can_read(p_channel uuid, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c record;
begin
  if p_channel is null or p_user is null then
    return false;
  end if;
  if not public.community__is_member(p_user) then
    return false;
  end if;

  select c.kind, c.visibility, c.audience, c.audience_plan_codes, c.audience_horse_ids
    into v_c
  from public.community_channels c
  where c.id = p_channel;
  if not found then
    return false;
  end if;

  -- DM は参加者のみ（運営であっても他人同士の DM は読めない）
  if v_c.kind = 'dm' then
    return exists (
      select 1 from public.community_channel_members m
      where m.channel_id = p_channel and m.user_id = p_user
    );
  end if;

  if public.community__is_staff(p_user) then
    return true;
  end if;

  if v_c.visibility = 'private' then
    return exists (
      select 1 from public.community_channel_members m
      where m.channel_id = p_channel and m.user_id = p_user
    );
  end if;

  return public.community__eligible(p_user, v_c.audience, v_c.audience_plan_codes, v_c.audience_horse_ids);
end;
$$;

-- 投稿できるか（p_is_reply = スレッドへの返信）
create or replace function public.community__can_post(p_channel uuid, p_user uuid, p_is_reply boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c record;
begin
  if not public.community__can_read(p_channel, p_user) then
    return false;
  end if;

  select c.kind, c.post_policy, c.is_archived
    into v_c
  from public.community_channels c
  where c.id = p_channel;

  if v_c.is_archived then
    return false;
  end if;

  if v_c.kind = 'dm' then
    -- 相手が退会・利用停止になっている DM には送れない
    return not exists (
      select 1 from public.community_channel_members m
      where m.channel_id = p_channel
        and m.user_id <> p_user
        and not public.community__is_active_user(m.user_id)
    );
  end if;

  if v_c.post_policy = 'staff' and not coalesce(p_is_reply, false)
     and not public.community__is_staff(p_user) then
    return false;
  end if;
  return true;
end;
$$;

-- ユーザーが読めるチャンネル・DM の一覧（参加状態・既読位置つき）。
-- community__can_read と同じ規則を1回のクエリでまとめて判定する（RLS・一覧・未読数で共用）。
--   is_joined: サイドバーに表示するか（DM は閉じていない／非公開はメンバー／公開は参加中または自動参加）
--   read_mark: 未読を数える基準（既読位置が無い場合は、過去の大量のメッセージを未読にしないよう直近14日）
create or replace function public.community__visible_channels(p_user uuid)
returns table (
  id uuid,
  kind text,
  name text,
  description text,
  topic text,
  category text,
  visibility text,
  audience text,
  audience_plan_codes text[],
  audience_horse_ids uuid[],
  post_policy text,
  auto_join boolean,
  is_required boolean,
  sort_order integer,
  is_archived boolean,
  created_by uuid,
  created_at timestamptz,
  has_row boolean,
  notify text,
  is_starred boolean,
  last_read_at timestamptz,
  is_joined boolean,
  read_mark timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with who as (
    select
      public.community__is_member(p_user) as ok,
      public.community__is_staff(p_user) as staff,
      public.community__customer_id(p_user) is not null as has_customer
  ),
  viewer as (
    select
      w.ok,
      w.staff,
      w.has_customer,
      case when w.ok and w.has_customer and not w.staff
        then public.community__member_codes(p_user) else '{}'::text[] end as codes,
      case when w.ok and w.has_customer and not w.staff
        then public.community__supported_horses(p_user) else '{}'::uuid[] end as horses
    from who w
  )
  select
    c.id,
    c.kind,
    c.name,
    c.description,
    c.topic,
    c.category,
    c.visibility,
    c.audience,
    c.audience_plan_codes,
    c.audience_horse_ids,
    c.post_policy,
    c.auto_join,
    c.is_required,
    c.sort_order,
    c.is_archived,
    c.created_by,
    c.created_at,
    (m.user_id is not null),
    m.notify,
    coalesce(m.is_starred, false),
    m.last_read_at,
    case
      when c.kind = 'dm' then not coalesce(m.hidden, false)
      when c.visibility = 'private' then m.user_id is not null and not m.hidden
      when m.user_id is not null then not m.hidden
      else c.auto_join
    end,
    coalesce(m.last_read_at, greatest(c.created_at, now() - interval '14 days'))
  from viewer v
  cross join public.community_channels c
  left join public.community_channel_members m
    on m.channel_id = c.id and m.user_id = p_user
  where p_user is not null
    and v.ok
    and (
      (c.kind = 'dm' and m.user_id is not null)
      or (
        c.kind = 'channel' and (
          v.staff
          or (c.visibility = 'private' and m.user_id is not null)
          or (
            c.visibility = 'public' and v.has_customer and (
              c.audience = 'all'
              or (c.audience = 'plans' and c.audience_plan_codes && v.codes)
              or (
                c.audience = 'supporters' and cardinality(v.horses) > 0
                and (cardinality(c.audience_horse_ids) = 0 or c.audience_horse_ids && v.horses)
              )
            )
          )
        )
      )
    );
$$;

-- コミュニティを利用できる全ユーザーと、参加資格の判定に使う会員種別・支援中の馬。
-- community__is_active_user / community__member_codes / community__supported_horses と同じ規則を
-- 1回のクエリでまとめて計算する（メンバー数の表示などで1人ずつ関数を呼ばないため）。
create or replace function public.community__member_pool()
returns table (user_id uuid, is_staff boolean, codes text[], horses uuid[])
language sql
stable
security definer
set search_path = public
as $$
  with staff as (
    select p.id as uid from public.profiles p
    where p.role in ('owner', 'admin', 'moderator')
      and not exists (select 1 from public.community_hidden_users h where h.user_id = p.id)
  ),
  links as (
    select c.auth_user_id as uid, c.id as cid, 0 as pri, c.created_at
    from public.customers c
    where c.auth_user_id is not null and c.status = 'active' and c.registration_completed is not false
    union all
    select p.id, c.id, 1, c.created_at
    from public.profiles p
    join public.customers c on c.id = p.customer_id
    where c.status = 'active' and c.registration_completed is not false
  ),
  cust as (
    select distinct on (l.uid) l.uid, l.cid
    from links l
    order by l.uid, l.pri, l.created_at
  ),
  members as (
    select k.uid, k.cid
    from cust k
    where not exists (select 1 from staff s where s.uid = k.uid)
      and not exists (select 1 from public.community_hidden_users h where h.user_id = k.uid)
      and not exists (
        select 1 from public.community_bans b
        where b.user_id = k.uid and (b.until is null or b.until > now())
      )
  ),
  detail as (
    select
      m.uid,
      array(
        select distinct y.code from (
          select mp.code::text as code
          from public.contracts ct
          join public.membership_plans mp on mp.id = ct.plan_id
          where ct.customer_id = m.cid and ct.status in ('active', 'past_due')
          union all
          select 'SUPPORT' where exists (
            select 1 from public.support_subscriptions s
            where s.customer_id = m.cid and s.status in ('active', 'past_due')
          )
          union all
          select 'SPECIAL_TEAM' where exists (
            select 1 from public.special_team_memberships t
            where t.customer_id = m.cid and t.status in ('active', 'past_due')
          )
        ) y
      ) as codes,
      array(
        select distinct z.horse_id from (
          select s.horse_id from public.support_subscriptions s
          where s.customer_id = m.cid and s.status in ('active', 'past_due') and s.horse_id is not null
          union all
          select t.horse_id from public.special_team_memberships t
          where t.customer_id = m.cid and t.status in ('active', 'past_due') and t.horse_id is not null
        ) z
      ) as horses
    from members m
  )
  select d.uid, false, case when cardinality(d.codes) = 0 then array['FREE']::text[] else d.codes end, d.horses
  from detail d
  union all
  select s.uid, true, '{}'::text[], '{}'::uuid[]
  from staff s;
$$;

-- チャンネルごとのメンバー数（Slack と同じく、そのチャンネルに参加している人の数）
--   DM: 参加者 / 非公開: 招待されたメンバー / 公開・自動参加: 参加資格のある全員（退出した人を除く）
--   公開・任意参加: 参加資格があり、参加している人
create or replace function public.community__member_counts(p_channels uuid[])
returns table (channel_id uuid, member_count integer)
language sql
stable
security definer
set search_path = public
as $$
  with pool as materialized (
    select * from public.community__member_pool()
  ),
  ch as (
    select c.* from public.community_channels c where c.id = any(coalesce(p_channels, '{}'::uuid[]))
  )
  select
    ch.id,
    (
      case
        when ch.kind = 'dm' then (
          select count(*) from public.community_channel_members m
          join pool p on p.user_id = m.user_id
          where m.channel_id = ch.id
        )
        when ch.visibility = 'private' then (
          select count(*) from public.community_channel_members m
          join pool p on p.user_id = m.user_id
          where m.channel_id = ch.id and not m.hidden
        )
        else (
          select count(*) from pool p
          where (
              p.is_staff
              or case ch.audience
                when 'all' then true
                when 'plans' then ch.audience_plan_codes && p.codes
                when 'supporters' then cardinality(p.horses) > 0
                  and (cardinality(ch.audience_horse_ids) = 0 or ch.audience_horse_ids && p.horses)
                else false
              end
            )
            and case
              when ch.auto_join then not exists (
                select 1 from public.community_channel_members m
                where m.channel_id = ch.id and m.user_id = p.user_id and m.hidden
              )
              else exists (
                select 1 from public.community_channel_members m
                where m.channel_id = ch.id and m.user_id = p.user_id and not m.hidden
              )
            end
        )
      end
    )::integer
  from ch;
$$;

-- チャンネルを管理（名前の変更・アーカイブ・非公開チャンネルのメンバー削除・ピン留め）できるか
-- 運営、またはチャンネルを作成した本人。
create or replace function public.community__can_manage(p_channel uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
    and public.community__can_read(p_channel, p_user)
    and exists (
      select 1 from public.community_channels c
      where c.id = p_channel
        and c.kind = 'channel'
        and (c.created_by = p_user or public.community__is_staff(p_user))
    );
$$;

-- チャンネル名を Slack と同じ形にそろえる（前後の空白と先頭の # を除き、空白は - に、英字は小文字に）
create or replace function public.community__normalize_channel_name(p_name text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(
    btrim(regexp_replace(btrim(coalesce(p_name, ''), E' \t\r\n　'), '^[#＃]+', ''), E' \t\r\n　'),
    E'[\\s　]+', '-', 'g'
  ));
$$;

-- 会員が付けるチャンネル名の検証。問題があれば例外を投げ、正規化した名前を返す。
create or replace function public.community__check_channel_name(p_name text, p_staff boolean)
returns text
language plpgsql
immutable
as $$
declare
  v_name text := public.community__normalize_channel_name(p_name);
begin
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'チャンネル名は1〜60文字で入力してください。' using errcode = '22023';
  end if;
  if v_name ~ E'[][<>@#&"''`\\\\/|*?:;,.!(){}=+~^%$]' then
    raise exception 'チャンネル名に記号は使えません（ハイフン - とアンダースコア _ は使えます）。' using errcode = '22023';
  end if;
  if not coalesce(p_staff, false)
     and v_name ~* '(運営|スタッフ|事務局|管理者|retouch|リタッチ|admin|staff|official|公式|お知らせ)' then
    raise exception '「運営」「公式」「お知らせ」などを含むチャンネル名は使用できません。' using errcode = '22023';
  end if;
  return v_name;
end;
$$;

-- 閲覧中のユーザーが運営か（RLS 用）
create or replace function public.community__is_staff_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.community__is_staff(auth.uid());
$$;

-- Storage のパス（<channel_id>/<user_id>/<file>）からチャンネルIDを取り出す
create or replace function public.community__path_channel(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(coalesce(p_name, ''), '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- =====================================================================
-- RLS・Storage・Realtime のポリシーから呼ぶ関数（ログイン中のユーザー自身について判定）
-- =====================================================================

create or replace function public.community_can_read(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.community__can_read(p_channel, auth.uid());
$$;

-- ログイン中のユーザーが読めるチャンネルID。RLS で `channel_id in (select …)` として使うと
-- 1クエリにつき1回だけ評価される（行ごとに community_can_read を呼ぶより大幅に速い）。
create or replace function public.community_readable_channel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.id from public.community__visible_channels(auth.uid()) v;
$$;

create or replace function public.community_viewer_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.community__is_member(auth.uid());
$$;

create or replace function public.community_storage_can_read(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.community__can_read(public.community__path_channel(p_name), auth.uid());
$$;

-- アップロードは自分のフォルダ（<channel>/<自分のID>/<ファイル>）にのみ、投稿できるチャンネルへ
create or replace function public.community_storage_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and split_part(coalesce(p_name, ''), '/', 2) = auth.uid()::text
    and split_part(p_name, '/', 3) <> ''
    and split_part(p_name, '/', 4) = ''
    and public.community__can_post(public.community__path_channel(p_name), auth.uid(), true);
$$;

create or replace function public.community_storage_can_delete(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and (
      split_part(coalesce(p_name, ''), '/', 2) = auth.uid()::text
      or public.community__is_staff(auth.uid())
    );
$$;

-- Realtime（入力中表示・オンライン表示）のトピック
--   community:presence           … コミュニティ参加者
--   community:typing:<channel>   … そのチャンネルを読める人
create or replace function public.community_realtime_allowed(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_topic = 'community:presence' then public.community__is_member(auth.uid())
    when p_topic like 'community:typing:%' then
      public.community__can_read(public.community__path_channel(substr(p_topic, 18)), auth.uid())
    else false
  end;
$$;

-- =====================================================================
-- 会員・運営が呼ぶ RPC（auth.uid() のユーザーとして動作）
-- =====================================================================

-- 画面を開いたときの状態確認。利用可能ならプロフィール行を用意する。
create or replace function public.community_bootstrap()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_member boolean;
  v_cust record;
  v_ban jsonb;
  v_profile jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('authenticated', false);
  end if;

  v_staff := public.community__is_staff(v_uid);
  v_member := public.community__is_member(v_uid);

  select jsonb_build_object('reason', b.reason, 'until', b.until)
    into v_ban
  from public.community_bans b
  where b.user_id = v_uid and (b.until is null or b.until > now());

  if v_member then
    select c.username, c.full_name, c.avatar_url
      into v_cust
    from public.customers c
    where c.auth_user_id = v_uid
    order by c.created_at
    limit 1;

    insert into public.community_profiles (user_id, display_name, avatar_url, is_staff, last_seen_at)
    values (
      v_uid,
      case
        when v_staff then left(coalesce(nullif(btrim(v_cust.full_name), ''), 'Retouch運営'), 40)
        else nullif(left(btrim(coalesce(v_cust.username, '')), 40), '')
      end,
      v_cust.avatar_url,
      v_staff,
      now()
    )
    on conflict (user_id) do update
      set avatar_url = excluded.avatar_url,
          is_staff = excluded.is_staff,
          last_seen_at = now();

    select to_jsonb(p) into v_profile
    from public.community_profiles p
    where p.user_id = v_uid;
  end if;

  return jsonb_build_object(
    'authenticated', true,
    'user_id', v_uid,
    'is_staff', v_staff,
    -- 互換用（常に利用可能。公開操作は廃止）
    'is_open', true,
    'is_active', public.community__is_active_user(v_uid),
    'is_member', v_member,
    'ban', v_ban,
    'profile', v_profile
  );
end;
$$;

-- 表示名・自己紹介・DM受付の設定
create or replace function public.community_update_profile(
  p_display_name text,
  p_bio text default null,
  p_allow_dm boolean default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
  v_staff boolean;
  v_row public.community_profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception '表示名は1〜40文字で入力してください。' using errcode = '22023';
  end if;
  if v_bio is not null and char_length(v_bio) > 300 then
    raise exception '自己紹介は300文字以内で入力してください。' using errcode = '22023';
  end if;

  v_staff := public.community__is_staff(v_uid);
  -- 運営のなりすまし防止
  if not v_staff and v_name ~* '(運営|スタッフ|事務局|管理者|retouch|リタッチ|admin|staff|official|公式)' then
    raise exception '「運営」「公式」「Retouch」などを含む表示名は使用できません。' using errcode = '22023';
  end if;

  insert into public.community_profiles (user_id, display_name, bio, allow_dm, is_staff, setup_done, last_seen_at)
  values (v_uid, v_name, v_bio, coalesce(p_allow_dm, true), v_staff, true, now())
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        bio = excluded.bio,
        allow_dm = coalesce(p_allow_dm, public.community_profiles.allow_dm),
        is_staff = excluded.is_staff,
        setup_done = true
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- サイドバー・チャンネル一覧（参加可能なチャンネルと自分の DM、未読数つき）
-- 戻り値の列を増やしたため、古い定義を削除してから作り直す。
drop function if exists public.community_list_channels();
create or replace function public.community_list_channels()
returns table (
  id uuid,
  kind text,
  name text,
  description text,
  topic text,
  category text,
  visibility text,
  audience text,
  audience_plan_codes text[],
  audience_horse_ids uuid[],
  post_policy text,
  auto_join boolean,
  is_required boolean,
  sort_order integer,
  is_archived boolean,
  created_at timestamptz,
  joined boolean,
  notify text,
  is_starred boolean,
  last_read_at timestamptz,
  unread_count integer,
  mention_count integer,
  last_message_at timestamptz,
  dm_user_id uuid,
  can_post boolean,
  created_by uuid,
  can_manage boolean,
  last_message_preview text,
  last_message_user_id uuid,
  member_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  v_staff := public.community__is_staff(v_uid);

  return query
  with vis as (
    select * from public.community__visible_channels(v_uid)
  )
  select
    s.id,
    s.kind,
    s.name,
    s.description,
    s.topic,
    s.category,
    s.visibility,
    s.audience,
    s.audience_plan_codes,
    s.audience_horse_ids,
    s.post_policy,
    s.auto_join,
    s.is_required,
    s.sort_order,
    s.is_archived,
    s.created_at,
    s.is_joined,
    s.notify,
    s.is_starred,
    s.last_read_at,
    coalesce(u.unread, 0)::integer,
    coalesce(u.mentions, 0)::integer,
    lm.created_at,
    dm.peer,
    (not s.is_archived and (s.kind = 'dm' or s.post_policy = 'everyone' or v_staff)),
    s.created_by,
    (s.kind = 'channel' and (v_staff or coalesce(s.created_by = v_uid, false))),
    -- 最新メッセージの冒頭（DM 一覧の表示用）
    case when s.kind = 'dm' then left(lm.body, 140) end,
    case when s.kind = 'dm' then lm.user_id end,
    coalesce(mc.member_count, 0)
  from vis s
  left join public.community__member_counts((select array_agg(v2.id) from vis v2)) mc
    on mc.channel_id = s.id
  left join lateral (
    select
      count(*) as unread,
      count(*) filter (where v_uid = any(msg.mentions) or msg.mention_channel) as mentions
    from public.community_messages msg
    where s.is_joined
      and msg.channel_id = s.id
      and msg.parent_id is null
      and msg.deleted_at is null
      and msg.created_at > s.read_mark
      and msg.user_id is distinct from v_uid
  ) u on true
  left join lateral (
    select msg.created_at, msg.body, msg.user_id
    from public.community_messages msg
    where msg.channel_id = s.id and msg.parent_id is null and msg.deleted_at is null
    order by msg.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select coalesce(
      (select m2.user_id from public.community_channel_members m2
        where m2.channel_id = s.id and m2.user_id <> v_uid
        order by m2.joined_at limit 1),
      v_uid
    ) as peer
    where s.kind = 'dm'
  ) dm on true;
end;
$$;

-- 未読数（サイトのヘッダーのバッジ用）。利用できない場合は null。
-- 一覧（community_list_channels）より軽い専用の集計にしている（全ページで呼ばれるため）。
create or replace function public.community_unread_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not public.community__is_member(v_uid) then
    return null;
  end if;

  with l as (
    select
      s.kind,
      coalesce(u.unread, 0) as unread_count,
      coalesce(u.mentions, 0) as mention_count,
      coalesce(
        s.notify,
        case when s.kind = 'dm' or s.post_policy = 'staff' then 'all' else 'mentions' end
      ) as eff_notify
    from public.community__visible_channels(v_uid) s
    left join lateral (
      select
        count(*) as unread,
        count(*) filter (where v_uid = any(msg.mentions) or msg.mention_channel) as mentions
      from public.community_messages msg
      where msg.channel_id = s.id
        and msg.parent_id is null
        and msg.deleted_at is null
        and msg.created_at > s.read_mark
        and msg.user_id is distinct from v_uid
    ) u on true
    where s.is_joined
  )
  select jsonb_build_object(
    'badge', coalesce(sum(
      case l.eff_notify
        when 'all' then l.unread_count
        when 'mentions' then l.mention_count
        else 0
      end
    ), 0),
    'has_unread', coalesce(bool_or(l.unread_count > 0 and l.eff_notify <> 'none'), false),
    'dm_unread', coalesce(sum(l.unread_count) filter (where l.kind = 'dm'), 0),
    -- 他の人から届いた未読メッセージの合計（ミュートしたチャンネルは除く。ヘッダーの赤い数字）
    'unread_total', coalesce(sum(l.unread_count) filter (where l.eff_notify <> 'none'), 0)
  )
  into v_result
  from l;

  return v_result;
end;
$$;

-- 公開チャンネルに参加（退出後の再参加を含む）
create or replace function public.community_join(p_channel uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__can_read(p_channel, v_uid) then
    raise exception 'このチャンネルには参加できません。' using errcode = '42501';
  end if;
  select c.kind into v_kind from public.community_channels c where c.id = p_channel;
  if v_kind <> 'channel' then
    raise exception 'このチャンネルには参加できません。' using errcode = '42501';
  end if;

  insert into public.community_channel_members (channel_id, user_id, hidden)
  values (p_channel, v_uid, false)
  on conflict (channel_id, user_id) do update set hidden = false;
end;
$$;

-- チャンネルから退出／DM を閉じる
create or replace function public.community_leave(p_channel uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c record;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select c.kind, c.visibility, c.is_required into v_c
  from public.community_channels c where c.id = p_channel;
  if not found then
    raise exception 'チャンネルが見つかりません。' using errcode = 'P0002';
  end if;
  if v_c.kind = 'channel' and v_c.is_required then
    raise exception 'このチャンネルからは退出できません。' using errcode = '42501';
  end if;

  if v_c.kind = 'channel' and v_c.visibility = 'private' then
    delete from public.community_channel_members
    where channel_id = p_channel and user_id = v_uid;
  else
    insert into public.community_channel_members (channel_id, user_id, hidden)
    values (p_channel, v_uid, true)
    on conflict (channel_id, user_id) do update set hidden = true;
  end if;
end;
$$;

-- 既読にする（チャンネルを表示したとき）
create or replace function public.community_mark_read(p_channel uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_c record;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__can_read(p_channel, v_uid) then
    raise exception 'このチャンネルは閲覧できません。' using errcode = '42501';
  end if;

  select c.kind, c.visibility, c.auto_join into v_c
  from public.community_channels c where c.id = p_channel;

  -- 非公開チャンネルを運営が（メンバーにならずに）閲覧しているだけの場合は記録しない
  if v_c.kind = 'channel' and v_c.visibility = 'private' and not exists (
    select 1 from public.community_channel_members m
    where m.channel_id = p_channel and m.user_id = v_uid
  ) then
    return v_now;
  end if;

  insert into public.community_channel_members (channel_id, user_id, last_read_at, hidden)
  values (
    p_channel,
    v_uid,
    v_now,
    -- 自動参加でない公開チャンネルを覗いただけなら「未参加」のまま
    (v_c.kind = 'channel' and v_c.visibility = 'public' and not v_c.auto_join)
  )
  on conflict (channel_id, user_id) do update
    set last_read_at = greatest(
      coalesce(public.community_channel_members.last_read_at, '-infinity'::timestamptz),
      excluded.last_read_at
    );
  return v_now;
end;
$$;

-- 「未読にする」: 指定したメッセージ以降を未読に戻す（既読位置をそのメッセージの直前へ移す）。
-- 戻り値は新しい既読位置。スレッド内の返信を指定した場合は、その親メッセージの位置を使う。
create or replace function public.community_mark_unread(p_message uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_msg record;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select m.channel_id, coalesce(p.created_at, m.created_at) as created_at
    into v_msg
  from public.community_messages m
  left join public.community_messages p on p.id = m.parent_id
  where m.id = p_message;
  if not found then
    raise exception 'メッセージが見つかりません。' using errcode = 'P0002';
  end if;
  if not public.community__can_read(v_msg.channel_id, v_uid) then
    raise exception 'このチャンネルは閲覧できません。' using errcode = '42501';
  end if;

  v_at := v_msg.created_at - interval '1 millisecond';
  update public.community_channel_members
    set last_read_at = v_at
  where channel_id = v_msg.channel_id and user_id = v_uid;
  if not found then
    -- まだ行が無い場合（自動参加の公開チャンネルなど）。community_mark_read と同じ扱いで、
    -- 非公開チャンネルを運営が覗いているだけなら記録せず、任意参加の公開チャンネルは未参加のままにする。
    if exists (
      select 1 from public.community_channels c
      where c.id = v_msg.channel_id and c.kind = 'channel' and c.visibility = 'private'
    ) then
      return v_at;
    end if;
    insert into public.community_channel_members (channel_id, user_id, last_read_at, hidden)
    select v_msg.channel_id, v_uid, v_at, (c.kind = 'channel' and c.visibility = 'public' and not c.auto_join)
    from public.community_channels c where c.id = v_msg.channel_id
    on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
  end if;
  return v_at;
end;
$$;

-- 通知設定（all / mentions / none / default）とスター
create or replace function public.community_set_prefs(
  p_channel uuid,
  p_notify text default null,
  p_starred boolean default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c record;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if p_notify is not null and p_notify not in ('all', 'mentions', 'none', 'default') then
    raise exception '通知設定が不正です。' using errcode = '22023';
  end if;
  if not public.community__can_read(p_channel, v_uid) then
    raise exception 'このチャンネルは閲覧できません。' using errcode = '42501';
  end if;

  select c.kind, c.visibility, c.auto_join into v_c
  from public.community_channels c where c.id = p_channel;
  if v_c.kind = 'channel' and v_c.visibility = 'private' and not exists (
    select 1 from public.community_channel_members m
    where m.channel_id = p_channel and m.user_id = v_uid
  ) then
    raise exception 'このチャンネルのメンバーではありません。' using errcode = '42501';
  end if;

  insert into public.community_channel_members (channel_id, user_id, notify, is_starred, hidden)
  values (
    p_channel,
    v_uid,
    case when p_notify in ('all', 'mentions', 'none') then p_notify end,
    coalesce(p_starred, false),
    (v_c.kind = 'channel' and v_c.visibility = 'public' and not v_c.auto_join)
  )
  on conflict (channel_id, user_id) do update
    set notify = case
          when p_notify is null then public.community_channel_members.notify
          when p_notify = 'default' then null
          else p_notify
        end,
        is_starred = coalesce(p_starred, public.community_channel_members.is_starred);
end;
$$;

-- DM を開く（無ければ作る）。チャンネルIDを返す。
create or replace function public.community_open_dm(p_user uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  if p_user is null or not public.community__is_active_user(p_user) then
    raise exception '相手のユーザーが見つかりません。' using errcode = 'P0002';
  end if;

  -- 会員同士の場合は、双方がプロフィールを設定済みで、相手が DM を受け付けていること
  if p_user <> v_uid
     and not public.community__is_staff(v_uid)
     and not public.community__is_staff(p_user) then
    if not exists (
      select 1 from public.community_profiles p where p.user_id = v_uid and p.setup_done
    ) then
      raise exception '先にプロフィール（表示名）を設定してください。' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.community_profiles p
      where p.user_id = p_user and p.setup_done and p.allow_dm
    ) then
      raise exception 'この方はダイレクトメッセージを受け付けていません。' using errcode = '42501';
    end if;
  end if;

  v_key := least(v_uid::text, p_user::text) || ':' || greatest(v_uid::text, p_user::text);

  select c.id into v_id from public.community_channels c where c.dm_key = v_key;
  if v_id is null then
    insert into public.community_channels (kind, dm_key, visibility, audience, post_policy, auto_join, created_by)
    values ('dm', v_key, 'private', 'all', 'everyone', false, v_uid)
    on conflict (dm_key) do nothing
    returning id into v_id;
    if v_id is null then
      select c.id into v_id from public.community_channels c where c.dm_key = v_key;
    end if;
  end if;

  insert into public.community_channel_members (channel_id, user_id, hidden)
  values (v_id, v_uid, false)
  on conflict (channel_id, user_id) do update set hidden = false;

  -- 相手側はメッセージが届くまでサイドバーに出さない
  if p_user <> v_uid then
    insert into public.community_channel_members (channel_id, user_id, hidden)
    values (v_id, p_user, true)
    on conflict (channel_id, user_id) do nothing;
  end if;

  return v_id;
end;
$$;

-- メッセージ送信（スレッド返信・添付・メンションを含む）
create or replace function public.community_send(
  p_channel uuid,
  p_body text,
  p_parent uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_mentions uuid[] default '{}'::uuid[],
  p_mention_channel boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_att jsonb := '[]'::jsonb;
  v_item jsonb;
  v_path text;
  v_prefix text;
  v_parent record;
  v_kind text;
  v_recent integer;
  v_mentions uuid[];
  v_msg public.community_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if p_channel is null then
    raise exception 'チャンネルが指定されていません。' using errcode = '22023';
  end if;

  if p_parent is not null then
    select m.channel_id, m.parent_id, m.deleted_at into v_parent
    from public.community_messages m where m.id = p_parent;
    if not found or v_parent.channel_id <> p_channel or v_parent.parent_id is not null then
      raise exception '返信先のメッセージが見つかりません。' using errcode = 'P0002';
    end if;
    if v_parent.deleted_at is not null then
      raise exception '削除されたメッセージには返信できません。' using errcode = '42501';
    end if;
  end if;

  if not public.community__can_post(p_channel, v_uid, p_parent is not null) then
    raise exception 'このチャンネルには投稿できません。' using errcode = '42501';
  end if;

  -- 添付ファイル（自分がこのチャンネル用にアップロードしたファイルのみ）
  if p_attachments is not null and jsonb_typeof(p_attachments) <> 'null' then
    if jsonb_typeof(p_attachments) <> 'array' then
      raise exception '添付ファイルの指定が不正です。' using errcode = '22023';
    end if;
    if jsonb_array_length(p_attachments) > 10 then
      raise exception '添付ファイルは1回に10個までです。' using errcode = '22023';
    end if;
    v_prefix := p_channel::text || '/' || v_uid::text || '/';
    for v_item in select value from jsonb_array_elements(p_attachments) loop
      v_path := case when jsonb_typeof(v_item) = 'object' then v_item ->> 'path' end;
      if v_path is null
         or left(v_path, length(v_prefix)) <> v_prefix
         or char_length(v_path) <= length(v_prefix)
         or position('/' in substr(v_path, length(v_prefix) + 1)) > 0
         or position('..' in v_path) > 0 then
        raise exception '添付ファイルの指定が不正です。' using errcode = '22023';
      end if;
      v_att := v_att || jsonb_build_array(jsonb_build_object(
        'path', v_path,
        'name', left(coalesce(nullif(btrim(v_item ->> 'name'), ''), 'file'), 200),
        'type', left(coalesce(v_item ->> 'type', ''), 100),
        'size', case when (v_item ->> 'size') ~ '^[0-9]{1,12}$' then (v_item ->> 'size')::bigint end
      ));
    end loop;
  end if;

  if v_body = '' and jsonb_array_length(v_att) = 0 then
    raise exception 'メッセージを入力してください。' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'メッセージは4000文字以内で入力してください。' using errcode = '22023';
  end if;
  if coalesce(p_mention_channel, false) and not public.community__is_staff(v_uid) then
    raise exception '@channel は運営のみ使用できます。' using errcode = '42501';
  end if;

  -- 連投の制限（荒らし・誤操作対策）
  select count(*) into v_recent
  from public.community_messages m
  where m.user_id = v_uid and m.created_at > now() - interval '1 minute';
  if v_recent >= 30 then
    raise exception '短時間に多くのメッセージが送信されました。少し時間をおいてから再度お試しください。'
      using errcode = '54000';
  end if;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_mentions
  from (
    select distinct u.id
    from unnest(coalesce(p_mentions, '{}'::uuid[])) as u(id)
    where u.id is not null
    limit 50
  ) x;

  insert into public.community_messages (channel_id, user_id, parent_id, body, attachments, mentions, mention_channel)
  values (p_channel, v_uid, p_parent, v_body, v_att, v_mentions, coalesce(p_mention_channel, false))
  returning * into v_msg;

  if p_parent is not null then
    update public.community_messages m
      set reply_count = m.reply_count + 1,
          last_reply_at = v_msg.created_at,
          last_reply_user_id = v_uid,
          reply_user_ids = case
            when v_uid = any(m.reply_user_ids) or cardinality(m.reply_user_ids) >= 50 then m.reply_user_ids
            else array_append(m.reply_user_ids, v_uid)
          end
    where m.id = p_parent;
  end if;

  select c.kind into v_kind from public.community_channels c where c.id = p_channel;
  if v_kind = 'dm' then
    -- 閉じていた相手のサイドバーにも再表示する
    update public.community_channel_members
      set hidden = false
    where channel_id = p_channel and hidden;
  end if;

  -- 投稿したチャンネルには参加扱いにし、自分の投稿までを既読にする
  insert into public.community_channel_members (channel_id, user_id, last_read_at, hidden)
  values (p_channel, v_uid, v_msg.created_at, false)
  on conflict (channel_id, user_id) do update
    set hidden = false,
        last_read_at = greatest(
          coalesce(public.community_channel_members.last_read_at, '-infinity'::timestamptz),
          excluded.last_read_at
        );

  return to_jsonb(v_msg);
end;
$$;

-- メッセージ編集（本人のみ）
create or replace function public.community_edit(
  p_message uuid,
  p_body text,
  p_mentions uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_msg public.community_messages%rowtype;
  v_mentions uuid[];
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;

  select * into v_msg from public.community_messages m where m.id = p_message for update;
  if not found or v_msg.deleted_at is not null then
    raise exception 'メッセージが見つかりません。' using errcode = 'P0002';
  end if;
  if v_msg.user_id is distinct from v_uid then
    raise exception '自分のメッセージのみ編集できます。' using errcode = '42501';
  end if;
  if not public.community__can_post(v_msg.channel_id, v_uid, true) then
    raise exception 'このチャンネルでは編集できません。' using errcode = '42501';
  end if;
  if v_body = '' and jsonb_array_length(v_msg.attachments) = 0 then
    raise exception 'メッセージを入力してください。' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'メッセージは4000文字以内で入力してください。' using errcode = '22023';
  end if;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_mentions
  from (
    select distinct u.id
    from unnest(coalesce(p_mentions, '{}'::uuid[])) as u(id)
    where u.id is not null
    limit 50
  ) x;

  update public.community_messages m
    set body = v_body,
        mentions = v_mentions,
        edited_at = now()
  where m.id = p_message
  returning * into v_msg;

  return to_jsonb(v_msg);
end;
$$;

-- メッセージ削除（本人、または運営によるモデレーション）。添付ファイル情報を返す。
create or replace function public.community_delete(p_message uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.community_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;

  select * into v_msg from public.community_messages m where m.id = p_message for update;
  if not found or v_msg.deleted_at is not null then
    raise exception 'メッセージが見つかりません。' using errcode = 'P0002';
  end if;
  if not public.community__can_read(v_msg.channel_id, v_uid) then
    raise exception 'このメッセージは削除できません。' using errcode = '42501';
  end if;
  if v_msg.user_id is distinct from v_uid and not public.community__is_staff(v_uid) then
    raise exception '自分のメッセージのみ削除できます。' using errcode = '42501';
  end if;

  update public.community_messages m
    set body = '',
        attachments = '[]'::jsonb,
        mentions = '{}'::uuid[],
        mention_channel = false,
        reactions = '{}'::jsonb,
        is_pinned = false,
        pinned_by = null,
        pinned_at = null,
        deleted_at = now(),
        deleted_by = v_uid
  where m.id = p_message;

  if v_msg.parent_id is not null then
    update public.community_messages m
      set reply_count = greatest(m.reply_count - 1, 0)
    where m.id = v_msg.parent_id;
  end if;

  return v_msg.attachments;
end;
$$;

-- リアクションの付け外し
create or replace function public.community_toggle_reaction(p_message uuid, p_emoji text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_emoji text := btrim(coalesce(p_emoji, ''));
  v_msg public.community_messages%rowtype;
  v_list jsonb;
  v_new jsonb;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if v_emoji = '' or char_length(v_emoji) > 16 then
    raise exception 'リアクションが不正です。' using errcode = '22023';
  end if;

  select * into v_msg from public.community_messages m where m.id = p_message for update;
  if not found or v_msg.deleted_at is not null then
    raise exception 'メッセージが見つかりません。' using errcode = 'P0002';
  end if;
  if not public.community__can_read(v_msg.channel_id, v_uid) then
    raise exception 'このメッセージにはリアクションできません。' using errcode = '42501';
  end if;
  if exists (select 1 from public.community_channels c where c.id = v_msg.channel_id and c.is_archived) then
    raise exception 'アーカイブされたチャンネルです。' using errcode = '42501';
  end if;

  v_list := coalesce(v_msg.reactions -> v_emoji, '[]'::jsonb);
  if v_list ? v_uid::text then
    v_list := v_list - v_uid::text;
  else
    if not (v_msg.reactions ? v_emoji)
       and (select count(*) from jsonb_object_keys(v_msg.reactions)) >= 30 then
      raise exception 'これ以上リアクションの種類を増やせません。' using errcode = '54000';
    end if;
    v_list := v_list || to_jsonb(v_uid::text);
  end if;

  if jsonb_array_length(v_list) = 0 then
    v_new := v_msg.reactions - v_emoji;
  else
    v_new := jsonb_set(v_msg.reactions, array[v_emoji], v_list, true);
  end if;

  update public.community_messages m set reactions = v_new
  where m.id = p_message
  returning * into v_msg;

  return to_jsonb(v_msg);
end;
$$;

-- ピン留め（チャンネルは運営とチャンネルの作成者、DM は参加者）
create or replace function public.community_toggle_pin(p_message uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.community_messages%rowtype;
  v_kind text;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;

  select * into v_msg from public.community_messages m where m.id = p_message for update;
  if not found or v_msg.deleted_at is not null or v_msg.parent_id is not null then
    raise exception 'メッセージが見つかりません。' using errcode = 'P0002';
  end if;
  if not public.community__can_read(v_msg.channel_id, v_uid) then
    raise exception 'このメッセージはピン留めできません。' using errcode = '42501';
  end if;
  select c.kind into v_kind from public.community_channels c where c.id = v_msg.channel_id;
  if v_kind = 'channel' and not public.community__can_manage(v_msg.channel_id, v_uid) then
    raise exception 'チャンネルのピン留めは運営とチャンネルの作成者のみ行えます。' using errcode = '42501';
  end if;

  update public.community_messages m
    set is_pinned = not v_msg.is_pinned,
        pinned_by = case when v_msg.is_pinned then null else v_uid end,
        pinned_at = case when v_msg.is_pinned then null else now() end
  where m.id = p_message
  returning * into v_msg;

  return to_jsonb(v_msg);
end;
$$;

-- 不適切なメッセージの通報
create or replace function public.community_report(p_message uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_msg public.community_messages%rowtype;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception '通報の理由を500文字以内で入力してください。' using errcode = '22023';
  end if;

  select * into v_msg from public.community_messages m where m.id = p_message;
  if not found or v_msg.deleted_at is not null then
    raise exception 'メッセージが見つかりません。' using errcode = 'P0002';
  end if;
  if not public.community__can_read(v_msg.channel_id, v_uid) then
    raise exception 'このメッセージは通報できません。' using errcode = '42501';
  end if;
  if v_msg.user_id = v_uid then
    raise exception '自分のメッセージは通報できません。' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.community_reports r
    where r.message_id = p_message and r.reporter_id = v_uid and r.status = 'open'
  ) then
    raise exception 'このメッセージはすでに通報済みです。' using errcode = '23505';
  end if;

  insert into public.community_reports (message_id, channel_id, reporter_id, reported_user_id, reason, message_body)
  values (p_message, v_msg.channel_id, v_uid, v_msg.user_id, v_reason, v_msg.body)
  returning id into v_id;
  return v_id;
end;
$$;

-- メッセージ検索（読めるチャンネル・DM のみ）
create or replace function public.community_search(p_query text, p_channel uuid default null)
returns table (
  id uuid,
  channel_id uuid,
  parent_id uuid,
  user_id uuid,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if v_uid is null or not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  if char_length(v_q) < 1 then
    return;
  end if;
  v_q := left(v_q, 100);
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select m.id, m.channel_id, m.parent_id, m.user_id, m.body, m.created_at
  from public.community_messages m
  where m.deleted_at is null
    and m.body ilike v_pattern
    and (p_channel is null or m.channel_id = p_channel)
    and m.channel_id in (select v.id from public.community__visible_channels(v_uid) v)
  order by m.created_at desc
  limit 50;
end;
$$;

-- DM の相手を探す（会員: DM 受付中の設定済みユーザー＋運営 / 運営: 利用可能な全会員）
create or replace function public.community_directory(p_query text default '')
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  is_staff boolean,
  real_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if v_uid is null or not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  v_pattern := '%' || replace(replace(replace(left(v_q, 50), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  if public.community__is_staff(v_uid) then
    return query
    with cand as (
      select c.auth_user_id as uid, c.full_name as real_name, c.full_name_kana as kana,
             c.username, c.avatar_url as cust_avatar
      from public.customers c
      where c.auth_user_id is not null
      union all
      select p.id, null::text, null::text, null::text, null::text
      from public.profiles p
      where p.role in ('owner', 'admin', 'moderator')
        and not exists (select 1 from public.customers c2 where c2.auth_user_id = p.id)
    ),
    uniq as (
      select distinct on (cand.uid) cand.*
      from cand
      order by cand.uid, cand.real_name nulls last
    )
    select
      u.uid,
      coalesce(cp.display_name, nullif(btrim(u.username), '')),
      coalesce(cp.avatar_url, u.cust_avatar),
      public.community__is_staff(u.uid),
      u.real_name
    from uniq u
    left join public.community_profiles cp on cp.user_id = u.uid
    where (
        v_q = ''
        or cp.display_name ilike v_pattern
        or u.real_name ilike v_pattern
        or u.kana ilike v_pattern
        or u.username ilike v_pattern
      )
      and public.community__is_active_user(u.uid)
      and not exists (select 1 from public.community_hidden_users h where h.user_id = u.uid)
    order by public.community__is_staff(u.uid) desc,
             coalesce(cp.display_name, u.username, u.real_name)
    limit 50;
  else
    return query
    select cp.user_id, cp.display_name, cp.avatar_url, public.community__is_staff(cp.user_id), null::text
    from public.community_profiles cp
    where cp.display_name is not null
      and (public.community__is_staff(cp.user_id) or (cp.setup_done and cp.allow_dm))
      and (v_q = '' or cp.display_name ilike v_pattern)
      and public.community__is_active_user(cp.user_id)
      and not exists (select 1 from public.community_hidden_users h where h.user_id = cp.user_id)
    order by public.community__is_staff(cp.user_id) desc, cp.display_name
    limit 50;
  end if;
end;
$$;

-- ユーザーの表示情報（本名・ユーザーネームは運営のみ）
create or replace function public.community_user_info(p_users uuid[])
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  bio text,
  is_staff boolean,
  real_name text,
  username text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
begin
  if v_uid is null or not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  v_staff := public.community__is_staff(v_uid);

  return query
  with ids as (
    select distinct u.id
    from unnest(coalesce(p_users, '{}'::uuid[])) as u(id)
    where u.id is not null
    limit 200
  )
  select
    ids.id,
    coalesce(cp.display_name, case when v_staff then nullif(btrim(cu.username), '') end),
    coalesce(cp.avatar_url, case when v_staff then cu.avatar_url end),
    cp.bio,
    public.community__is_staff(ids.id),
    case when v_staff then cu.full_name end,
    case when v_staff then cu.username end
  from ids
  left join public.community_profiles cp on cp.user_id = ids.id
  left join lateral (
    select c.full_name, c.username, c.avatar_url
    from public.customers c
    where c.auth_user_id = ids.id
    order by c.created_at
    limit 1
  ) cu on true;
end;
$$;

-- @メンションの候補（そのチャンネルを読める、表示名設定済みのユーザー）
create or replace function public.community_mention_candidates(p_channel uuid, p_query text default '')
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  is_staff boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if v_uid is null or not public.community__can_read(p_channel, v_uid) then
    return;
  end if;
  v_pattern := replace(replace(replace(left(v_q, 40), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select cp.user_id, cp.display_name, cp.avatar_url, cp.is_staff
  from public.community_profiles cp
  where cp.display_name is not null
    and cp.user_id <> v_uid
    and (v_q = '' or cp.display_name ilike v_pattern)
    and public.community__can_read(p_channel, cp.user_id)
    and not exists (select 1 from public.community_hidden_users h where h.user_id = cp.user_id)
  order by cp.is_staff desc, cp.display_name
  limit 8;
end;
$$;

-- ユーザー表示情報を JSON 配列で返す（下の RPC がまとめて返すため。community_user_info と同じ公開範囲）
create or replace function public.community__users_json(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb)
  from public.community_user_info(coalesce(p_ids, '{}'::uuid[])) u;
$$;

-- チャンネルのメッセージ（古い順）。p_before を渡すとそれより前の最大 p_limit 件。
-- 権限の確認は1回だけ行い、表示に必要なユーザー情報も同時に返す（往復を1回にするため）。
create or replace function public.community_history(
  p_channel uuid,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_messages jsonb;
  v_count integer;
  v_ids uuid[];
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__can_read(p_channel, v_uid) then
    raise exception 'このチャンネルは閲覧できません。' using errcode = '42501';
  end if;

  with page as (
    select m.*
    from public.community_messages m
    where m.channel_id = p_channel
      and m.parent_id is null
      and (
        p_before is null
        or (p_before_id is null and m.created_at < p_before)
        or (p_before_id is not null and (m.created_at, m.id) < (p_before, p_before_id))
      )
    order by m.created_at desc, m.id desc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id), '[]'::jsonb),
    count(*)::integer,
    coalesce(
      (select array_agg(distinct x.id) from (
        select p2.user_id as id from page p2
        union all select unnest(p2.mentions) from page p2
        union all select unnest(p2.reply_user_ids[1:3]) from page p2
      ) x where x.id is not null),
      '{}'::uuid[]
    )
  into v_messages, v_count, v_ids
  from page p;

  return jsonb_build_object(
    'messages', v_messages,
    'has_more', v_count >= v_limit,
    'users', public.community__users_json(v_ids)
  );
end;
$$;

-- スレッド（親メッセージと返信、ユーザー情報）
create or replace function public.community_thread(p_parent uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_parent public.community_messages%rowtype;
  v_replies jsonb;
  v_ids uuid[];
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select * into v_parent from public.community_messages m where m.id = p_parent;
  if not found or v_parent.parent_id is not null then
    raise exception 'スレッドが見つかりません。' using errcode = 'P0002';
  end if;
  if not public.community__can_read(v_parent.channel_id, v_uid) then
    raise exception 'このスレッドは閲覧できません。' using errcode = '42501';
  end if;

  with r as (
    select m.*
    from public.community_messages m
    where m.parent_id = p_parent
    order by m.created_at, m.id
    limit 1000
  )
  select
    coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb),
    coalesce(
      (select array_agg(distinct x.id) from (
        select r2.user_id as id from r r2
        union all select unnest(r2.mentions) from r r2
      ) x where x.id is not null),
      '{}'::uuid[]
    )
  into v_replies, v_ids
  from r;

  return jsonb_build_object(
    'parent', to_jsonb(v_parent),
    'replies', v_replies,
    'users', public.community__users_json(v_ids || v_parent.mentions || array[v_parent.user_id])
  );
end;
$$;

-- 画面を開いたときに必要なもの（利用状態・チャンネル一覧・最初に表示するチャンネルの
-- メッセージ・ユーザー情報）を1回の呼び出しで返す。p_channel は前回開いていたチャンネル。
create or replace function public.community_init(p_channel uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_boot jsonb;
  v_channels jsonb;
  v_target uuid;
  v_history jsonb;
  v_ids uuid[];
begin
  v_boot := public.community_bootstrap();
  if v_uid is null or not coalesce((v_boot ->> 'is_member')::boolean, false) then
    return v_boot;
  end if;

  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    into v_channels
  from public.community_list_channels() l;

  if p_channel is not null and exists (
    select 1 from jsonb_array_elements(v_channels) e where (e ->> 'id')::uuid = p_channel
  ) then
    v_target := p_channel;
  else
    select (e ->> 'id')::uuid into v_target
    from jsonb_array_elements(v_channels) e
    where e ->> 'kind' = 'channel' and (e ->> 'joined')::boolean
    order by (e ->> 'sort_order')::integer, e ->> 'name'
    limit 1;
  end if;

  if v_target is not null then
    v_history := public.community_history(v_target, null, null, 50);
  end if;

  select coalesce(array_agg(distinct x.id), '{}'::uuid[])
    into v_ids
  from (
    select v_uid as id
    union all
    select (e ->> 'dm_user_id')::uuid from jsonb_array_elements(v_channels) e
    where e ->> 'dm_user_id' is not null
    union all
    select (e ->> 'last_message_user_id')::uuid from jsonb_array_elements(v_channels) e
    where e ->> 'last_message_user_id' is not null
  ) x;

  return v_boot || jsonb_build_object(
    'channels', v_channels,
    'channel_id', v_target,
    'history', v_history,
    'users', public.community__users_json(v_ids)
  );
end;
$$;

-- チャンネルを作成する（会員も作成できる）。作成者はメンバーになり、p_members も追加する。
--   会員: 誰でも投稿できる・自動参加なしのチャンネルのみ。1日5個・同時に30個まで。
--   運営: 「運営のみ投稿（お知らせ用）」「全員を自動参加」も指定できる。
create or replace function public.community_create_channel(
  p_name text,
  p_description text default null,
  p_visibility text default 'public',
  p_members uuid[] default '{}'::uuid[],
  p_post_policy text default 'everyone',
  p_auto_join boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_name text;
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_policy text;
  v_id uuid;
  v_member uuid;
  v_recent integer;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  v_staff := public.community__is_staff(v_uid);
  if not v_staff and not exists (
    select 1 from public.community_profiles p where p.user_id = v_uid and p.setup_done
  ) then
    raise exception '先にプロフィール（表示名）を設定してください。' using errcode = '42501';
  end if;
  if p_visibility is null or p_visibility not in ('public', 'private') then
    raise exception '公開範囲の指定が不正です。' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception '説明は500文字以内で入力してください。' using errcode = '22023';
  end if;
  v_name := public.community__check_channel_name(p_name, v_staff);
  v_policy := case when v_staff and p_post_policy = 'staff' then 'staff' else 'everyone' end;

  if not v_staff then
    select count(*) into v_recent
    from public.community_channels c
    where c.kind = 'channel' and c.created_by = v_uid and c.created_at > now() - interval '1 day';
    if v_recent >= 5 then
      raise exception '1日に作成できるチャンネルは5つまでです。時間をおいてから再度お試しください。'
        using errcode = '54000';
    end if;
    select count(*) into v_total
    from public.community_channels c
    where c.kind = 'channel' and c.created_by = v_uid and not c.is_archived;
    if v_total >= 30 then
      raise exception '作成できるチャンネルは30個までです。使わなくなったチャンネルをアーカイブしてください。'
        using errcode = '54000';
    end if;
  end if;

  begin
    insert into public.community_channels
      (kind, name, description, category, visibility, audience, post_policy, auto_join, is_required, sort_order, created_by)
    values (
      'channel',
      v_name,
      v_desc,
      case when v_policy = 'staff' then 'announcement' else 'general' end,
      p_visibility,
      'all',
      v_policy,
      v_staff and p_visibility = 'public' and coalesce(p_auto_join, false),
      false,
      100,
      v_uid
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception '「%」という名前のチャンネルはすでにあります。別の名前にしてください。', v_name
      using errcode = '23505';
  end;

  insert into public.community_channel_members (channel_id, user_id, hidden, last_read_at)
  values (v_id, v_uid, false, now());

  for v_member in
    select distinct u.id
    from unnest(coalesce(p_members, '{}'::uuid[])) as u(id)
    where u.id is not null and u.id <> v_uid
    limit 100
  loop
    if public.community__is_active_user(v_member) then
      insert into public.community_channel_members (channel_id, user_id, hidden)
      values (v_id, v_member, false)
      on conflict (channel_id, user_id) do update set hidden = false;
    end if;
  end loop;

  return v_id;
end;
$$;

-- チャンネル名・トピック・説明の変更（null = 変更しない、'' = 消す）
--   名前: 作成者と運営のみ / トピック・説明: 作成者・運営、または誰でも投稿できるチャンネルの参加者
create or replace function public.community_update_channel(
  p_channel uuid,
  p_name text default null,
  p_topic text default null,
  p_description text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c record;
  v_staff boolean;
  v_manage boolean;
  v_joined boolean;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select c.kind, c.is_archived, c.post_policy, c.created_by into v_c
  from public.community_channels c where c.id = p_channel;
  if not found or v_c.kind <> 'channel' or not public.community__can_read(p_channel, v_uid) then
    raise exception 'チャンネルが見つかりません。' using errcode = 'P0002';
  end if;
  if v_c.is_archived then
    raise exception 'アーカイブされたチャンネルは編集できません。' using errcode = '42501';
  end if;
  v_staff := public.community__is_staff(v_uid);
  v_manage := v_staff or coalesce(v_c.created_by = v_uid, false);
  select v.is_joined into v_joined from public.community__visible_channels(v_uid) v where v.id = p_channel;

  if p_name is not null and not v_manage then
    raise exception 'チャンネル名を変更できるのは作成者と運営のみです。' using errcode = '42501';
  end if;
  if (p_topic is not null or p_description is not null)
     and not (v_manage or (v_c.post_policy = 'everyone' and coalesce(v_joined, false))) then
    raise exception 'このチャンネルの情報は変更できません。' using errcode = '42501';
  end if;
  if p_topic is not null and char_length(btrim(p_topic)) > 200 then
    raise exception 'トピックは200文字以内で入力してください。' using errcode = '22023';
  end if;
  if p_description is not null and char_length(btrim(p_description)) > 500 then
    raise exception '説明は500文字以内で入力してください。' using errcode = '22023';
  end if;

  begin
    update public.community_channels c
      set name = case when p_name is null then c.name
                      else public.community__check_channel_name(p_name, v_staff) end,
          topic = case when p_topic is null then c.topic else nullif(btrim(p_topic), '') end,
          description = case when p_description is null then c.description
                             else nullif(btrim(p_description), '') end
    where c.id = p_channel;
  exception when unique_violation then
    raise exception '同じ名前のチャンネルがすでにあります。' using errcode = '23505';
  end;
end;
$$;

-- チャンネルのアーカイブ／解除（作成者と運営のみ。全員参加のチャンネルは不可）
create or replace function public.community_set_channel_archived(p_channel uuid, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_required boolean;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__can_manage(p_channel, v_uid) then
    raise exception 'チャンネルをアーカイブできるのは作成者と運営のみです。' using errcode = '42501';
  end if;
  select c.is_required into v_required from public.community_channels c where c.id = p_channel;
  if coalesce(p_archived, true) and v_required then
    raise exception '全員参加のチャンネルはアーカイブできません。' using errcode = '42501';
  end if;
  update public.community_channels c set is_archived = coalesce(p_archived, true) where c.id = p_channel;
end;
$$;

-- メンバーを追加する（チャンネルの参加者と運営）。追加した人数を返す。
--   公開チャンネル: 参加資格のある人のみ / 非公開チャンネル: 招待した人がメンバーになる
create or replace function public.community_invite(p_channel uuid, p_users uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c record;
  v_staff boolean;
  v_joined boolean;
  v_member uuid;
  v_n integer;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select c.kind, c.visibility, c.is_archived, c.auto_join into v_c
  from public.community_channels c where c.id = p_channel;
  if not found or v_c.kind <> 'channel' or not public.community__can_read(p_channel, v_uid) then
    raise exception 'チャンネルが見つかりません。' using errcode = 'P0002';
  end if;
  if v_c.is_archived then
    raise exception 'アーカイブされたチャンネルです。' using errcode = '42501';
  end if;
  v_staff := public.community__is_staff(v_uid);
  select v.is_joined into v_joined from public.community__visible_channels(v_uid) v where v.id = p_channel;
  if not v_staff and not coalesce(v_joined, false) then
    raise exception 'メンバーを追加するには、先にチャンネルに参加してください。' using errcode = '42501';
  end if;
  if not v_staff and not exists (
    select 1 from public.community_profiles p where p.user_id = v_uid and p.setup_done
  ) then
    raise exception '先にプロフィール（表示名）を設定してください。' using errcode = '42501';
  end if;

  for v_member in
    select distinct u.id
    from unnest(coalesce(p_users, '{}'::uuid[])) as u(id)
    where u.id is not null and u.id <> v_uid
    limit 100
  loop
    continue when not public.community__is_active_user(v_member);
    if v_c.visibility = 'public' then
      continue when not public.community__can_read(p_channel, v_member);
      -- 自動参加のチャンネルは、退出していなければすでにメンバー
      continue when v_c.auto_join and not exists (
        select 1 from public.community_channel_members m
        where m.channel_id = p_channel and m.user_id = v_member and m.hidden
      );
    end if;
    insert into public.community_channel_members (channel_id, user_id, hidden)
    values (p_channel, v_member, false)
    on conflict (channel_id, user_id) do update set hidden = false
      where public.community_channel_members.hidden;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;

-- 非公開チャンネルからメンバーを外す（作成者と運営のみ。自分自身の場合は退出）
create or replace function public.community_remove_member(p_channel uuid, p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c record;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select c.kind, c.visibility, c.created_by into v_c from public.community_channels c where c.id = p_channel;
  if not found or v_c.kind <> 'channel' then
    raise exception 'チャンネルが見つかりません。' using errcode = 'P0002';
  end if;
  if p_user = v_uid then
    perform public.community_leave(p_channel);
    return;
  end if;
  if not public.community__can_manage(p_channel, v_uid) then
    raise exception 'メンバーを外せるのはチャンネルの作成者と運営のみです。' using errcode = '42501';
  end if;
  if v_c.visibility <> 'private' then
    raise exception '公開チャンネルからメンバーを外すことはできません（本人が退出できます）。' using errcode = '42501';
  end if;
  delete from public.community_channel_members m
  where m.channel_id = p_channel and m.user_id = p_user;
end;
$$;

-- チャンネルのメンバー（人数と、表示名のある人の一覧 最大200人）
--   自動参加の公開チャンネルは、参加資格のある全員（退出した人を除く）がメンバー。
create or replace function public.community_channel_member_list(p_channel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c record;
  v_staff boolean;
  v_ids uuid[];
  v_show uuid[];
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__can_read(p_channel, v_uid) then
    raise exception 'このチャンネルは閲覧できません。' using errcode = '42501';
  end if;
  select c.kind, c.visibility, c.auto_join, c.audience, c.audience_plan_codes, c.audience_horse_ids
    into v_c
  from public.community_channels c where c.id = p_channel;
  v_staff := public.community__is_staff(v_uid);

  -- community__member_counts と同じ規則（数と一覧が必ず一致する）
  if v_c.kind = 'dm' then
    select coalesce(array_agg(m.user_id), '{}'::uuid[]) into v_ids
    from public.community_channel_members m
    join public.community__member_pool() p on p.user_id = m.user_id
    where m.channel_id = p_channel;
  elsif v_c.visibility = 'private' then
    select coalesce(array_agg(m.user_id order by m.joined_at), '{}'::uuid[]) into v_ids
    from public.community_channel_members m
    join public.community__member_pool() p on p.user_id = m.user_id
    where m.channel_id = p_channel and not m.hidden;
  else
    select coalesce(array_agg(p.user_id), '{}'::uuid[]) into v_ids
    from public.community__member_pool() p
    where (
        p.is_staff
        or case v_c.audience
          when 'all' then true
          when 'plans' then v_c.audience_plan_codes && p.codes
          when 'supporters' then cardinality(p.horses) > 0
            and (cardinality(v_c.audience_horse_ids) = 0 or v_c.audience_horse_ids && p.horses)
          else false
        end
      )
      and case
        when v_c.auto_join then not exists (
          select 1 from public.community_channel_members m
          where m.channel_id = p_channel and m.user_id = p.user_id and m.hidden
        )
        else exists (
          select 1 from public.community_channel_members m
          where m.channel_id = p_channel and m.user_id = p.user_id and not m.hidden
        )
      end;
  end if;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_show
  from (
    select u.id
    from unnest(v_ids) as u(id)
    left join public.community_profiles cp on cp.user_id = u.id
    where v_staff or cp.display_name is not null
    order by coalesce(cp.is_staff, false) desc, cp.display_name nulls last
    limit 200
  ) x;

  return jsonb_build_object(
    'total', cardinality(v_ids),
    'users', public.community__users_json(v_show)
  );
end;
$$;

-- チャンネルに追加できる人の候補（表示名を設定済みの利用者。p_channel を指定すると参加中の人を除く）
create or replace function public.community_invite_candidates(p_channel uuid default null, p_query text default '')
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  is_staff boolean,
  real_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
  v_staff boolean;
begin
  if v_uid is null or not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  if p_channel is not null and not public.community__can_read(p_channel, v_uid) then
    raise exception 'このチャンネルは閲覧できません。' using errcode = '42501';
  end if;
  v_staff := public.community__is_staff(v_uid);
  v_pattern := '%' || replace(replace(replace(left(v_q, 50), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select cp.user_id, cp.display_name, cp.avatar_url, cp.is_staff, cu.full_name
  from public.community_profiles cp
  left join lateral (
    select c.full_name
    from public.customers c
    where v_staff and c.auth_user_id = cp.user_id
    order by c.created_at
    limit 1
  ) cu on true
  where cp.display_name is not null
    and cp.user_id <> v_uid
    and (cp.setup_done or cp.is_staff)
    and (v_q = '' or cp.display_name ilike v_pattern or cu.full_name ilike v_pattern)
    and (
      p_channel is null
      or not exists (
        select 1 from public.community_channel_members m
        where m.channel_id = p_channel and m.user_id = cp.user_id and not m.hidden
      )
    )
    and public.community__is_active_user(cp.user_id)
    and not exists (select 1 from public.community_hidden_users h where h.user_id = cp.user_id)
  order by cp.is_staff desc, cp.display_name
  limit 30;
end;
$$;

-- アクティビティ（直近30日の、自分へのメンション・@channel・参加したスレッドへの返信。チャンネルのみ）
create or replace function public.community_activity(p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_seen timestamptz;
  v_items jsonb;
  v_ids uuid[];
begin
  if v_uid is null or not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  select cp.activity_seen_at into v_seen from public.community_profiles cp where cp.user_id = v_uid;

  with rc as (
    select v.id, v.is_joined
    from public.community__visible_channels(v_uid) v
    where v.kind = 'channel'
  ),
  mine as (
    select m.id
    from public.community_messages m
    where m.parent_id is null
      and m.channel_id in (select rc.id from rc)
      and (m.user_id = v_uid or m.reply_user_ids @> array[v_uid])
      and m.last_reply_at > now() - interval '30 days'
  ),
  hits as (
    select
      m.*,
      case
        when m.mentions @> array[v_uid] then 'mention'
        when m.mention_channel then 'channel'
        else 'reply'
      end as reason
    from public.community_messages m
    where m.deleted_at is null
      and m.user_id is distinct from v_uid
      and m.created_at > now() - interval '30 days'
      and m.channel_id in (select rc.id from rc)
      and (
        m.mentions @> array[v_uid]
        or (m.mention_channel and m.channel_id in (select rc.id from rc where rc.is_joined))
        or m.parent_id in (select mine.id from mine)
      )
    order by m.created_at desc
    limit v_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object('reason', h.reason, 'message', to_jsonb(h) - 'reason')
        order by h.created_at desc
      ),
      '[]'::jsonb
    ),
    coalesce(
      (select array_agg(distinct x.id) from (
        select h2.user_id as id from hits h2
        union all select unnest(h2.mentions) from hits h2
      ) x where x.id is not null),
      '{}'::uuid[]
    )
  into v_items, v_ids
  from hits h;

  return jsonb_build_object(
    'items', v_items,
    'seen_at', v_seen,
    'users', public.community__users_json(v_ids)
  );
end;
$$;

-- アクティビティを確認済みにする
create or replace function public.community_mark_activity_seen()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  update public.community_profiles p set activity_seen_at = v_now where p.user_id = v_uid;
  return v_now;
end;
$$;

-- =====================================================================
-- 管理画面（サーバー側・service_role）専用の関数
-- =====================================================================

-- 対象者（全会員／会員種別／支援者）に該当する利用可能な会員（運営・利用停止中は除く）
create or replace function public.community_audience_users(
  p_audience text,
  p_codes text[] default '{}'::text[],
  p_horses uuid[] default '{}'::uuid[]
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct c.auth_user_id
  from public.customers c
  where c.auth_user_id is not null
    and c.status = 'active'
    and c.registration_completed is not false
    and not public.community__is_banned(c.auth_user_id)
    and not public.community__is_staff(c.auth_user_id)
    and public.community__eligible(c.auth_user_id, p_audience, p_codes, p_horses);
$$;

-- 運営から複数の会員へ個別の DM を一括送信する。送信件数を返す。
create or replace function public.community_bulk_dm(
  p_sender uuid,
  p_recipients uuid[],
  p_body text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_recipient uuid;
  v_key text;
  v_id uuid;
  v_count integer := 0;
  v_now timestamptz := now();
begin
  if not public.community__is_staff(p_sender) then
    raise exception '送信者は運営アカウントである必要があります。' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'メッセージは1〜4000文字で入力してください。' using errcode = '22023';
  end if;

  for v_recipient in
    select distinct r.id
    from unnest(coalesce(p_recipients, '{}'::uuid[])) as r(id)
    where r.id is not null and r.id <> p_sender
  loop
    if not public.community__is_active_user(v_recipient) then
      continue;
    end if;

    v_key := least(p_sender::text, v_recipient::text) || ':' || greatest(p_sender::text, v_recipient::text);
    v_id := null;
    select c.id into v_id from public.community_channels c where c.dm_key = v_key;
    if v_id is null then
      insert into public.community_channels (kind, dm_key, visibility, audience, post_policy, auto_join, created_by)
      values ('dm', v_key, 'private', 'all', 'everyone', false, p_sender)
      on conflict (dm_key) do nothing
      returning id into v_id;
      if v_id is null then
        select c.id into v_id from public.community_channels c where c.dm_key = v_key;
      end if;
    end if;

    insert into public.community_channel_members (channel_id, user_id, hidden, last_read_at)
    values (v_id, p_sender, false, v_now)
    on conflict (channel_id, user_id) do update
      set hidden = false,
          last_read_at = greatest(
            coalesce(public.community_channel_members.last_read_at, '-infinity'::timestamptz),
            excluded.last_read_at
          );
    insert into public.community_channel_members (channel_id, user_id, hidden)
    values (v_id, v_recipient, false)
    on conflict (channel_id, user_id) do update set hidden = false;

    insert into public.community_messages (channel_id, user_id, body)
    values (v_id, p_sender, v_body);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- チャンネルごとの投稿数・最終投稿（管理画面の一覧用）
create or replace function public.community_admin_channel_stats()
returns table (channel_id uuid, message_count bigint, last_message_at timestamptz, member_rows bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    (select count(*) from public.community_messages m where m.channel_id = c.id and m.deleted_at is null),
    (select max(m.created_at) from public.community_messages m where m.channel_id = c.id and m.deleted_at is null),
    (select count(*) from public.community_channel_members cm where cm.channel_id = c.id and not cm.hidden)
  from public.community_channels c
  where c.kind = 'channel';
$$;

-- ユーザーごとの投稿数・最終投稿（管理画面のユーザー一覧用）
create or replace function public.community_admin_user_stats()
returns table (user_id uuid, message_count bigint, last_message_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, count(*), max(m.created_at)
  from public.community_messages m
  where m.user_id is not null and m.deleted_at is null
  group by m.user_id;
$$;

-- =====================================================================
-- 行レベルセキュリティ（閲覧のみ許可。書き込みは上記の関数経由のみ）
-- =====================================================================

alter table public.community_profiles enable row level security;
alter table public.community_channels enable row level security;
alter table public.community_channel_members enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_bans enable row level security;
alter table public.community_reports enable row level security;
-- 表示しないアカウントの一覧はサーバー側（security definer の関数）からのみ参照する
alter table public.community_hidden_users enable row level security;
revoke all on public.community_hidden_users from anon, authenticated;

drop policy if exists "community profiles read" on public.community_profiles;
create policy "community profiles read" on public.community_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.community_viewer_is_member());

-- 読めるチャンネルの一覧は1クエリにつき1回だけ計算する（`in (select …)`）。
-- 規則そのものは community__can_read と同じ（community__visible_channels を参照）。
drop policy if exists "community channels read" on public.community_channels;
create policy "community channels read" on public.community_channels
  for select to authenticated
  using (id in (select public.community_readable_channel_ids()));

drop policy if exists "community members read" on public.community_channel_members;
create policy "community members read" on public.community_channel_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or channel_id in (select public.community_readable_channel_ids())
  );

drop policy if exists "community messages read" on public.community_messages;
create policy "community messages read" on public.community_messages
  for select to authenticated
  using (channel_id in (select public.community_readable_channel_ids()));

drop policy if exists "community bans staff read" on public.community_bans;
create policy "community bans staff read" on public.community_bans
  for select to authenticated
  using (user_id = auth.uid() or public.community__is_staff_viewer());

drop policy if exists "community reports staff read" on public.community_reports;
create policy "community reports staff read" on public.community_reports
  for select to authenticated
  using (public.community__is_staff_viewer());

-- テーブルへの直接の書き込みは不可（anon は閲覧も不可）
revoke all on table
  public.community_profiles,
  public.community_channels,
  public.community_channel_members,
  public.community_messages,
  public.community_bans,
  public.community_reports
from anon;
revoke insert, update, delete, truncate, references, trigger on table
  public.community_profiles,
  public.community_channels,
  public.community_channel_members,
  public.community_messages,
  public.community_bans,
  public.community_reports
from authenticated;
-- 画面から直接読むのはチャンネル・参加状態（既読）・メッセージのみ（Realtime もこの3つ）。
grant select on table
  public.community_channels,
  public.community_channel_members,
  public.community_messages
to authenticated;
-- プロフィール・利用停止・通報は RPC（community_user_info など）とサーバー経由のみ。
-- 会員が API で他の会員のプロフィールを一覧取得できないよう、直接の SELECT も許可しない。
revoke select on table
  public.community_profiles,
  public.community_bans,
  public.community_reports
from authenticated;
grant all on table
  public.community_profiles,
  public.community_channels,
  public.community_channel_members,
  public.community_messages,
  public.community_bans,
  public.community_reports
to service_role;

-- =====================================================================
-- 関数の実行権限
--   内部判定関数・管理用関数: authenticated / anon からは実行不可
--   RPC・ポリシー用関数: ログイン済みユーザー（authenticated）のみ
-- =====================================================================

revoke all on function public.community__touch_updated_at() from public, anon, authenticated;
revoke all on function public.community__is_staff(uuid) from public, anon, authenticated;
revoke all on function public.community__is_banned(uuid) from public, anon, authenticated;
revoke all on function public.community__customer_id(uuid) from public, anon, authenticated;
revoke all on function public.community__is_active_user(uuid) from public, anon, authenticated;
revoke all on function public.community__is_member(uuid) from public, anon, authenticated;
revoke all on function public.community__member_codes(uuid) from public, anon, authenticated;
revoke all on function public.community__supported_horses(uuid) from public, anon, authenticated;
revoke all on function public.community__eligible(uuid, text, text[], uuid[]) from public, anon, authenticated;
revoke all on function public.community__can_read(uuid, uuid) from public, anon, authenticated;
revoke all on function public.community__can_post(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.community__path_channel(text) from public, anon, authenticated;
revoke all on function public.community__visible_channels(uuid) from public, anon, authenticated;
revoke all on function public.community__can_manage(uuid, uuid) from public, anon, authenticated;
revoke all on function public.community__normalize_channel_name(text) from public, anon, authenticated;
revoke all on function public.community__check_channel_name(text, boolean) from public, anon, authenticated;
revoke all on function public.community__users_json(uuid[]) from public, anon, authenticated;
revoke all on function public.community__member_pool() from public, anon, authenticated;
revoke all on function public.community__member_counts(uuid[]) from public, anon, authenticated;
revoke all on function public.community_audience_users(text, text[], uuid[]) from public, anon, authenticated;
revoke all on function public.community_bulk_dm(uuid, uuid[], text) from public, anon, authenticated;
revoke all on function public.community_admin_channel_stats() from public, anon, authenticated;
revoke all on function public.community_admin_user_stats() from public, anon, authenticated;

grant execute on function public.community_audience_users(text, text[], uuid[]) to service_role;
grant execute on function public.community_bulk_dm(uuid, uuid[], text) to service_role;
grant execute on function public.community_admin_channel_stats() to service_role;
grant execute on function public.community_admin_user_stats() to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.community_is_open()',
    'public.community_can_read(uuid)',
    'public.community_viewer_is_member()',
    'public.community__is_staff_viewer()',
    'public.community_storage_can_read(text)',
    'public.community_storage_can_upload(text)',
    'public.community_storage_can_delete(text)',
    'public.community_realtime_allowed(text)',
    'public.community_bootstrap()',
    'public.community_update_profile(text, text, boolean)',
    'public.community_list_channels()',
    'public.community_unread_summary()',
    'public.community_join(uuid)',
    'public.community_leave(uuid)',
    'public.community_mark_read(uuid)',
    'public.community_mark_unread(uuid)',
    'public.community_set_prefs(uuid, text, boolean)',
    'public.community_open_dm(uuid)',
    'public.community_send(uuid, text, uuid, jsonb, uuid[], boolean)',
    'public.community_edit(uuid, text, uuid[])',
    'public.community_delete(uuid)',
    'public.community_toggle_reaction(uuid, text)',
    'public.community_toggle_pin(uuid)',
    'public.community_report(uuid, text)',
    'public.community_search(text, uuid)',
    'public.community_directory(text)',
    'public.community_user_info(uuid[])',
    'public.community_mention_candidates(uuid, text)',
    'public.community_readable_channel_ids()',
    'public.community_history(uuid, timestamptz, uuid, integer)',
    'public.community_thread(uuid)',
    'public.community_init(uuid)',
    'public.community_create_channel(text, text, text, uuid[], text, boolean)',
    'public.community_update_channel(uuid, text, text, text)',
    'public.community_set_channel_archived(uuid, boolean)',
    'public.community_invite(uuid, uuid[])',
    'public.community_remove_member(uuid, uuid)',
    'public.community_channel_member_list(uuid)',
    'public.community_invite_candidates(uuid, text)',
    'public.community_activity(integer)',
    'public.community_mark_activity_seen()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- =====================================================================
-- Realtime（新着メッセージ・既読・チャンネル変更をリアルタイム配信）
--   配信時にも上記の RLS が適用されるため、読めないメッセージは届かない。
-- =====================================================================

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    foreach t in array array['community_messages', 'community_channel_members', 'community_channels'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- 入力中表示・オンライン表示（Realtime の Broadcast / Presence）を参加者だけに限定する。
-- Realtime Authorization（realtime.messages）が無い古いプロジェクトでは何もしない
-- （その場合、入力中・オンライン表示だけが動かず、チャット本体には影響しない）。
do $$
begin
  if to_regclass('realtime.messages') is not null
     and to_regprocedure('realtime.topic()') is not null then
    execute 'drop policy if exists "community realtime receive" on realtime.messages';
    execute $p$
      create policy "community realtime receive" on realtime.messages
        for select to authenticated
        using (
          realtime.messages.extension in ('broadcast', 'presence')
          and public.community_realtime_allowed((select realtime.topic()))
        )
    $p$;
    execute 'drop policy if exists "community realtime send" on realtime.messages';
    execute $p$
      create policy "community realtime send" on realtime.messages
        for insert to authenticated
        with check (
          realtime.messages.extension in ('broadcast', 'presence')
          and public.community_realtime_allowed((select realtime.topic()))
        )
    $p$;
  end if;
end;
$$;

-- =====================================================================
-- 添付ファイル（非公開バケット community。閲覧は署名付きURLのみ）
--   パス: <channel_id>/<user_id>/<ランダム名>  最大 10MB
-- =====================================================================

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'community',
      'community',
      false,
      10485760,
      array[
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ]
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;

  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "community files read" on storage.objects';
    execute $p$
      create policy "community files read" on storage.objects
        for select to authenticated
        using (bucket_id = 'community' and public.community_storage_can_read(name))
    $p$;
    execute 'drop policy if exists "community files upload" on storage.objects';
    execute $p$
      create policy "community files upload" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'community' and public.community_storage_can_upload(name))
    $p$;
    execute 'drop policy if exists "community files delete" on storage.objects';
    execute $p$
      create policy "community files delete" on storage.objects
        for delete to authenticated
        using (bucket_id = 'community' and public.community_storage_can_delete(name))
    $p$;
  end if;
end;
$$;

-- =====================================================================
-- 初期チャンネル（同名のチャンネルが無い場合のみ作成。管理画面で編集・削除できる）
-- =====================================================================

insert into public.community_channels
  (kind, name, description, category, visibility, audience, post_policy, auto_join, is_required, sort_order)
select 'channel', v.name, v.description, v.category, 'public', v.audience, v.post_policy, v.auto_join, v.is_required, v.sort_order
from (values
  ('みんなの広場', 'Retouch会員のみなさん全員が参加している、自由に投稿できる交流の場です。お気軽にどうぞ。',
    'general', 'all', 'everyone', true, true, 0),
  ('自己紹介', 'はじめて参加された方は、ぜひこちらで自己紹介をどうぞ。好きな馬やRetouchを知ったきっかけなど、お気軽に。',
    'general', 'all', 'everyone', true, false, 1),
  ('質問・相談', 'Retouchや馬のこと、サイトの使い方など、わからないことはお気軽にご質問ください。運営や会員のみなさんがお答えします。',
    'general', 'all', 'everyone', true, false, 2),
  ('写真・動画', '牧場見学やイベントで撮った写真・動画をみんなで共有しましょう。',
    'general', 'all', 'everyone', true, false, 3),
  ('お知らせ', 'Retouch事務局からのお知らせです。ご質問はスレッドで返信してください。',
    'announcement', 'all', 'staff', true, true, 10),
  ('全体', 'Retouch会員のみなさんの交流チャンネルです。お気軽にどうぞ。',
    'general', 'all', 'everyone', true, true, 20),
  ('運営スタッフ', '運営メンバー専用のチャンネルです（会員には表示されません）。',
    'staff', 'staff', 'everyone', true, false, 90)
) as v(name, description, category, audience, post_policy, auto_join, is_required, sort_order)
where not exists (
  select 1 from public.community_channels c
  where c.kind = 'channel' and lower(c.name) = lower(v.name)
);

-- 会員種別（ランク）ごとの非公開チャンネル。その会員種別の方だけが自動で参加し、契約の開始・終了に
-- 自動で追従する（ほかの会員には表示されない）。同じ会員種別のチャンネルがすでにある場合は作らない。
insert into public.community_channels
  (kind, name, description, category, visibility, audience, audience_plan_codes, post_policy, auto_join, is_required, sort_order)
select 'channel', v.name, v.description, 'rank', 'public', 'plans', array[v.code], 'everyone', true, false, v.sort_order
from (values
  ('A', 'メンバーズ会員', 'メンバーズ会員（アテンダー会員を含む）の方だけが参加している非公開チャンネルです。', 50),
  ('B', 'サポーター会員', 'サポーター会員の方だけが参加している非公開チャンネルです。', 51),
  ('C', 'リェリーフ会員', 'リェリーフ会員の方だけが参加している非公開チャンネルです。', 52),
  ('OWNER', 'オーナーズ会員', 'オーナーズ会員の方だけが参加している非公開チャンネルです。', 53),
  ('SUPPORT', 'ヘルパーズ会員', '一口支援（ヘルパーズ会員）の方だけが参加している非公開チャンネルです。', 54),
  ('RPT', 'リタポメンバー', 'RetouchPony【リタポ】メンバーの方だけが参加している非公開チャンネルです。', 55),
  ('SPECIAL_TEAM', '特別チーム会員', '特別チーム会員の方だけが参加している非公開チャンネルです。', 56)
) as v(code, name, description, sort_order)
where not exists (
  select 1 from public.community_channels c
  where c.kind = 'channel'
    and (
      lower(c.name) = lower(v.name)
      or (c.audience = 'plans' and c.audience_plan_codes = array[v.code])
    )
);

-- 初期チャンネルのアイコン（設定済みのものは変更しない。管理画面・チャンネルの詳細から変更できる）
update public.community_channels c
  set icon = v.icon
from (values
  ('みんなの広場', '🏡'),
  ('自己紹介', '👋'),
  ('質問・相談', '💬'),
  ('写真・動画', '📷'),
  ('お知らせ', '📣'),
  ('全体', '🌿'),
  ('運営スタッフ', '🛡️')
) as v(name, icon)
where c.kind = 'channel' and c.name = v.name and c.icon is null;

-- 会員種別（ランク）ごとのチャンネル
update public.community_channels c
  set icon = v.icon
from (values
  ('A', '🐴'),
  ('B', '🤝'),
  ('C', '🌈'),
  ('OWNER', '👑'),
  ('SUPPORT', '💐'),
  ('RPT', '🐎'),
  ('SPECIAL_TEAM', '🏆')
) as v(code, icon)
where c.kind = 'channel' and c.audience = 'plans' and c.audience_plan_codes = array[v.code] and c.icon is null;
