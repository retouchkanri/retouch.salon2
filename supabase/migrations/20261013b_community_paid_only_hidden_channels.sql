-- =====================================================================
-- 会員コミュニティ: 有料会員だけが利用できる・チャンネルを非表示にできる（2026-10-13）
--
--   1. コミュニティを利用できるのは、運営と有料会員（会員種別のある有効な会員）だけにする。
--      会員種別のない会員（無料会員）は、コミュニティを開けず、メンバーの人数・一覧・DM の宛先にも出ない。
--      （community__is_active_user / community__member_pool / community_audience_users）
--      画面で案内を出し分けられるよう、community_bootstrap が is_free を返す。
--   2. チャンネルに「非表示」（community_channels.is_hidden）を追加する。非表示のチャンネルは、
--      コミュニティの画面で運営を含めて誰にも表示しない。メッセージやメンバーの記録は残り、
--      管理画面で「非表示」を外すと元どおり表示される。
--      （community__can_read / community__visible_channels。一覧・検索・通知・ファイルの閲覧はこの 2つに従う）
--   3. 表示するのは「自己紹介」と、支援馬ごとのチャンネルだけにする。それ以外（お知らせ・質問・相談・
--      ご意見箱・みんなの広場・写真・動画・会員種別ごとのチャンネル・運営スタッフ）は非表示にする。
--
-- 適用: scripts/apply-community-paid-only.mjs（全体を1つのトランザクションで実行する）。
--       Supabase ダッシュボード → SQL Editor に全文を貼り付けて Run しても同じ（再実行しても安全）。
-- 前提: 20261012b_community_admin_controls.sql までを適用済みであること。
-- 元に戻す: チャンネルは管理画面 → コミュニティ → チャンネル → 編集 で「非表示」を外す。
--           無料会員も利用できるようにするには、community__is_active_user と community__member_pool を
--           20261012b_community_admin_controls.sql より前の supabase/community.sql の定義に戻す。
-- supabase/community.sql にも同じ定義を反映済み。
-- =====================================================================

-- 非表示（2026-10-13）: true のチャンネルは、コミュニティの画面で運営を含めて誰にも表示しない。
-- メッセージやメンバーの記録は残り、管理画面で false に戻すと元どおり表示される。
alter table public.community_channels add column if not exists is_hidden boolean not null default false;

create or replace function public.community__is_active_user(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user is null then
    return false;
  end if;
  if public.community__is_staff(p_user) then
    return true;
  end if;
  return not public.community__is_banned(p_user)
    and public.community__customer_id(p_user) is not null
    and public.community__member_codes(p_user) <> array['FREE']::text[];
end;
$$;

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
  -- コミュニティを利用できるのは有料会員（会員種別のある会員）だけ。会員種別のない会員（無料会員）は含めない。
  select d.uid, false, d.codes, d.horses
  from detail d
  where cardinality(d.codes) > 0
  union all
  select s.uid, true, '{}'::text[], '{}'::uuid[]
  from staff s;
$$;

create or replace function public.community__can_read(p_channel uuid, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c record;
  v_access text;
  v_row boolean;
begin
  if p_channel is null or p_user is null then
    return false;
  end if;
  if not public.community__is_member(p_user) then
    return false;
  end if;

  select c.kind, c.category, c.visibility, c.audience, c.audience_plan_codes, c.audience_horse_ids, c.is_hidden
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

  -- 非表示にしたチャンネルは、運営を含めて誰にも表示しない
  if v_c.is_hidden then
    return false;
  end if;

  if public.community__is_staff(p_user) then
    return true;
  end if;

  select m.access into v_access
  from public.community_channel_members m
  where m.channel_id = p_channel and m.user_id = p_user;
  v_row := found;

  -- 運営が外した人は閲覧できない。運営が追加した人は、対象者に当てはまらなくても閲覧できる。
  if v_access = 'removed' then
    return false;
  end if;
  if v_access = 'granted' then
    return true;
  end if;

  if v_c.visibility = 'private' then
    -- 非公開チャンネルは行がある人がメンバー。ただし会員種別のない会員（無料会員）は、運営が追加した
    -- 場合（上の granted）とお知らせのチャンネルを除き、行が残っていても閲覧できない。
    return v_row and (
      v_c.category = 'announcement'
      or public.community__member_codes(p_user) <> array['FREE']::text[]
    );
  end if;

  return public.community__eligible(p_user, v_c.audience, v_c.audience_plan_codes, v_c.audience_horse_ids);
end;
$$;

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
        -- 非表示にしたチャンネルは、運営を含めて誰にも表示しない
        c.kind = 'channel' and not c.is_hidden and (
          v.staff
          or (
            -- 運営が外した人（removed）には表示しない
            m.access is distinct from 'removed'
            and (
              -- 運営が追加した人（granted）は、対象者に当てはまらなくてもメンバー
              m.access = 'granted'
              -- 非公開チャンネルは行がある人。無料会員は、お知らせを除き、運営が追加した場合だけ
              or (
                c.visibility = 'private' and m.user_id is not null
                and (c.category = 'announcement' or v.codes <> array['FREE']::text[])
              )
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
        )
      )
    );
$$;

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
  v_free boolean;
  v_cust record;
  v_ban jsonb;
  v_profile jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('authenticated', false);
  end if;

  v_staff := public.community__is_staff(v_uid);
  v_member := public.community__is_member(v_uid);
  -- 会員種別のない会員（無料会員）は利用できない。画面の案内を出し分けるために知らせる。
  v_free := not v_staff
    and public.community__customer_id(v_uid) is not null
    and public.community__member_codes(v_uid) = array['FREE']::text[];

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
    'is_free', v_free,
    'ban', v_ban,
    'profile', v_profile
  );
end;
$$;

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
    -- コミュニティを利用できる会員（有料会員）だけ
    and public.community__is_active_user(c.auth_user_id)
    and public.community__eligible(c.auth_user_id, p_audience, p_codes, p_horses);
$$;

-- ---------------------------------------------------------------------
-- チャンネルの設定
-- ---------------------------------------------------------------------

-- 自己紹介: コミュニティを利用できる会員全員に表示する
update public.community_channels c
  set is_hidden = false,
      visibility = 'public',
      audience = 'all',
      audience_plan_codes = '{}',
      audience_horse_ids = '{}',
      auto_join = true
where c.kind = 'channel' and c.name = '自己紹介'
  and (c.is_hidden or c.visibility <> 'public' or c.audience <> 'all' or not c.auto_join);

-- それ以外（公開チャンネル・会員種別ごとのチャンネル・運営スタッフ）は非表示にする。支援馬ごとのチャンネルは変えない。
update public.community_channels c
  set is_hidden = true
where c.kind = 'channel' and not c.is_hidden
  and (
    c.name in ('お知らせ', '質問・相談', 'ご意見箱', 'みんなの広場', '写真・動画')
    or c.category in ('rank', 'staff')
  );

-- API（PostgREST）に、増えた列を読み込ませる
notify pgrst, 'reload schema';
