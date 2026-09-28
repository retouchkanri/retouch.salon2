-- =====================================================================
-- 会員コミュニティ: 動作確認用のテストアカウントを一覧に表示しない（2026-09-28）
--
-- community_hidden_users に登録したユーザーを、次の一覧から除外する:
--   ・チャンネルのメンバー一覧・メンバー数（community__member_pool）
--   ・DM の宛先検索（community_directory）
--   ・@メンション候補（community_mention_candidates）
--   ・チャンネルへの招待候補（community_invite_candidates）
-- アカウント自体は削除・停止しない（ログインや管理画面での動作確認はそのまま可能）。
-- 投稿済みのメッセージには従来どおり名前が表示される。
--
-- 適用: Supabase ダッシュボード → SQL Editor にこのファイルの全文を貼り付けて Run（再実行しても安全）。
-- 元に戻す: delete from public.community_hidden_users where user_id = '<ユーザーID>';
-- supabase/community.sql にも同じ変更を反映済み。
-- =====================================================================

create table if not exists public.community_hidden_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.community_hidden_users enable row level security;
revoke all on public.community_hidden_users from anon, authenticated;

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

-- 非表示にするテストアカウント
insert into public.community_hidden_users (user_id, note) values
  ('33d141f6-054a-4460-adeb-ebe6934765e5', 'テストオーナー（kindman207@gmail.com / owner）'),
  ('79cd2c67-ef5e-43b3-b510-4c2ee095b497', 'モデレーター（horse@gamil.com / moderator）')
on conflict (user_id) do nothing;
