-- =====================================================================
-- 会員コミュニティ: 会員に公開するときの参加ルール（2026-10-12）
--
--   1. お知らせ（category = announcement）は会員全員が閲覧できる（運営のみ投稿。従来どおり）。
--   2. 会員種別のない会員（無料会員）が閲覧できるのは、お知らせのチャンネルだけ。
--      非公開チャンネルに行が残っていても、ほかのチャンネルは読めず、メンバーにも数えない。
--   3. チャンネルの作成・メンバーの追加は運営のみ。会員が自分で参加できるのは、自動で参加する
--      チャンネルに戻るとき（退出後の再参加）だけ。
--   4. 会員種別ごとのチャンネルは、その会員種別の方が自動で参加する（契約の開始・終了に追従）。
--      2026-09-28 に「非公開（招待制）」へ変えられていたため、自動で参加しなくなっていた。
--   5. 動作確認用のテストアカウント（テストオーナー・モデレーター）を、メンバー一覧・人数などに出さない。
--
-- 適用: scripts/apply-community-member-access.mjs（全体を1つのトランザクションで実行する）。
--       Supabase ダッシュボード → SQL Editor に全文を貼り付けて Run しても同じ（再実行しても安全）。
-- 元に戻す: 関数は 2026-10-12 より前の supabase/community.sql の定義を実行し直す。チャンネルの設定は
--           管理画面 → コミュニティ → チャンネルで「非公開（招待制）」に戻す。テストアカウントの表示は
--           delete from public.community_hidden_users where user_id = '<ユーザーID>';
-- supabase/community.sql にも同じ関数定義を反映済み。
-- =====================================================================

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

  select c.kind, c.category, c.visibility, c.audience, c.audience_plan_codes, c.audience_horse_ids
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

  -- 会員種別のない会員（無料会員）が閲覧できるのは、お知らせのチャンネルだけ
  -- （非公開チャンネルに行が残っていても、ほかのチャンネルは読めない）
  if v_c.category <> 'announcement' and public.community__member_codes(p_user) = array['FREE']::text[] then
    return false;
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
          or (
            -- 会員種別のない会員（無料会員）が閲覧できるのは、お知らせのチャンネルだけ
            (c.category = 'announcement' or v.codes <> array['FREE']::text[])
            and (
              (c.visibility = 'private' and m.user_id is not null)
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
            -- 無料会員は、お知らせ以外のチャンネルのメンバーに数えない（閲覧できないため）
            and (p.is_staff or ch.category = 'announcement' or p.codes <> array['FREE']::text[])
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
            and (p.is_staff or ch.category = 'announcement' or p.codes <> array['FREE']::text[])
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

create or replace function public.community_join(p_channel uuid)
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
  if not public.community__can_read(p_channel, v_uid) then
    raise exception 'このチャンネルには参加できません。' using errcode = '42501';
  end if;
  select c.kind, c.visibility, c.auto_join into v_c from public.community_channels c where c.id = p_channel;
  if v_c.kind <> 'channel' then
    raise exception 'このチャンネルには参加できません。' using errcode = '42501';
  end if;
  -- 会員が自分で参加できるのは、会員種別などに応じて自動で参加するチャンネルに戻るとき（退出後の再参加）だけ。
  -- それ以外のチャンネルへの追加は運営が行う。
  if not public.community__is_staff(v_uid) and not (v_c.visibility = 'public' and v_c.auto_join) then
    raise exception 'このチャンネルには参加できません。' using errcode = '42501';
  end if;

  insert into public.community_channel_members (channel_id, user_id, hidden)
  values (p_channel, v_uid, false)
  on conflict (channel_id, user_id) do update set hidden = false;
end;
$$;

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
  if not v_staff then
    raise exception 'チャンネルを作成できるのは運営のみです。' using errcode = '42501';
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
  v_member uuid;
  v_n integer;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select c.kind, c.category, c.visibility, c.is_archived, c.auto_join into v_c
  from public.community_channels c where c.id = p_channel;
  if not found or v_c.kind <> 'channel' or not public.community__can_read(p_channel, v_uid) then
    raise exception 'チャンネルが見つかりません。' using errcode = 'P0002';
  end if;
  if v_c.is_archived then
    raise exception 'アーカイブされたチャンネルです。' using errcode = '42501';
  end if;
  v_staff := public.community__is_staff(v_uid);
  if not v_staff then
    raise exception 'メンバーを追加できるのは運営のみです。' using errcode = '42501';
  end if;

  for v_member in
    select distinct u.id
    from unnest(coalesce(p_users, '{}'::uuid[])) as u(id)
    where u.id is not null and u.id <> v_uid
    limit 100
  loop
    continue when not public.community__is_active_user(v_member);
    -- 会員種別のない会員（無料会員）は、お知らせ以外のチャンネルには追加しない
    continue when v_c.category <> 'announcement'
      and not public.community__is_staff(v_member)
      and public.community__member_codes(v_member) = array['FREE']::text[];
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
  select c.kind, c.category, c.visibility, c.auto_join, c.audience, c.audience_plan_codes, c.audience_horse_ids
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
    where m.channel_id = p_channel and not m.hidden
      -- 無料会員は、お知らせ以外のチャンネルのメンバーに数えない（閲覧できないため）
      and (p.is_staff or v_c.category = 'announcement' or p.codes <> array['FREE']::text[]);
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
      and (p.is_staff or v_c.category = 'announcement' or p.codes <> array['FREE']::text[])
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

-- ---------------------------------------------------------------------
-- チャンネルの設定
-- ---------------------------------------------------------------------

-- お知らせ: 会員全員に自動で表示する（運営のみ投稿。会員は退出できない）。
update public.community_channels c
  set visibility = 'public', audience = 'all', auto_join = true, is_required = true
where c.kind = 'channel' and c.category = 'announcement' and c.name = 'お知らせ'
  and c.visibility = 'private';

-- 会員種別ごとのチャンネル: その会員種別の方が自動で参加する（ほかの会員には表示されない）。
update public.community_channels c
  set visibility = 'public', auto_join = true
where c.kind = 'channel' and c.category = 'rank' and c.audience = 'plans'
  and cardinality(c.audience_plan_codes) > 0
  and c.visibility = 'private';

-- ---------------------------------------------------------------------
-- 表示しないテストアカウント（community_hidden_users。2026-09-28 の移行で登録するはずだった2件）
-- ---------------------------------------------------------------------
insert into public.community_hidden_users (user_id, note)
select u.id, v.note
from (values
  ('33d141f6-054a-4460-adeb-ebe6934765e5'::uuid, 'テストオーナー（動作確認用 / owner）'),
  ('79cd2c67-ef5e-43b3-b510-4c2ee095b497'::uuid, 'モデレーター（動作確認用 / moderator）')
) as v(id, note)
join auth.users u on u.id = v.id
on conflict (user_id) do nothing;
