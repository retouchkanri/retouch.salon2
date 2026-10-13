-- =====================================================================
-- 会員コミュニティ: 運営によるチャンネル・メンバー・DM の管理（2026-10-12）
--
--   1. 「みんなの広場」を全会員（無料会員を含む）に表示する。
--      無料会員が閲覧できるのは、全会員が対象の公開チャンネル（お知らせ・みんなの広場）と、
--      運営が手動で追加したチャンネル。
--   2. 運営は、どのチャンネルでも会員を手動で追加・削除できる（community_channel_members.access）。
--        granted = 運営が追加した人（対象者に当てはまらなくてもメンバー）
--        removed = 運営が外した人（対象者に当てはまっていても閲覧できず、自分では戻れない）
--      管理画面からは community_admin_set_members、コミュニティの画面からは community_invite /
--      community_remove_member を使う（どちらも community__set_member を呼ぶ）。
--   3. メンバーを追加するときの検索（community_invite_candidates）で、コミュニティをまだ開いたことの
--      ない会員も氏名・フリガナで探せる（運営のみ）。
--   4. 運営は DM に自分用の名前を付けられる（community_dm_labels。付けた本人にだけ表示）。
--      DM の削除は /api/community/dms/[id]（サーバー側）で行う。
--
-- 適用: scripts/apply-community-admin-controls.mjs（全体を1つのトランザクションで実行する）。
--       Supabase ダッシュボード → SQL Editor に全文を貼り付けて Run しても同じ（再実行しても安全）。
-- 前提: 20261012_community_member_access.sql を適用済みであること。
-- 元に戻す: 関数は 20261012_community_member_access.sql と、それより前の supabase/community.sql の定義を
--           実行し直す。追加した列（access）とテーブル（community_dm_labels）は残しても動作に影響しない。
-- supabase/community.sql にも同じ定義を反映済み。
-- =====================================================================

-- 運営が手動で決めた参加状態（2026-10-12）
--   granted: 運営が追加した人。対象者（会員種別など）に当てはまらなくても、そのチャンネルのメンバーになる。
--   removed: 運営が外した人。対象者に当てはまっていても、そのチャンネルを閲覧できず、自分では戻れない。
--   null   : 手動の指定なし（対象者の規則どおり）。
alter table public.community_channel_members
  add column if not exists access text check (access is null or access in ('granted', 'removed'));

-- DM の表示名（運営が自分用に付ける名前。付けた本人にだけ表示し、相手には見えない）
create table if not exists public.community_dm_labels (
  channel_id uuid not null references public.community_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  updated_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- DM の表示名は、付けた本人の分だけを関数（community_list_channels）が返す。直接の参照は許可しない
alter table public.community_dm_labels enable row level security;
revoke all on public.community_dm_labels from anon, authenticated;
grant all on table public.community_dm_labels to service_role;

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
        c.kind = 'channel' and (
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
            and m.access is distinct from 'removed'
            -- 無料会員は、運営が追加した場合とお知らせを除き、メンバーに数えない（閲覧できないため）
            and (p.is_staff or m.access = 'granted' or ch.category = 'announcement' or p.codes <> array['FREE']::text[])
        )
        else (
          select count(*) from pool p
          left join public.community_channel_members m
            on m.channel_id = ch.id and m.user_id = p.user_id
          -- 運営が外した人は数えない
          where m.access is distinct from 'removed'
            and (
              -- 運営が追加した人
              (m.access = 'granted' and not m.hidden)
              -- 対象者（参加している人。自動参加のチャンネルは、退出していない人）
              or (
                (
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
                  when ch.auto_join then not coalesce(m.hidden, false)
                  else m.user_id is not null and not m.hidden
                end
              )
            )
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
  -- 会員が自分で参加できるのは、会員種別などに応じて自動で参加するチャンネルか、運営に追加されたチャンネルに
  -- 戻るとき（退出後の再参加）だけ。それ以外のチャンネルへの追加は運営が行う。
  -- （運営が外した人は、上の community__can_read で断られる）
  if not public.community__is_staff(v_uid)
     and not (v_c.visibility = 'public' and v_c.auto_join)
     and not exists (
       select 1 from public.community_channel_members m
       where m.channel_id = p_channel and m.user_id = v_uid and m.access = 'granted'
     ) then
    raise exception 'このチャンネルには参加できません。' using errcode = '42501';
  end if;

  insert into public.community_channel_members (channel_id, user_id, hidden)
  values (p_channel, v_uid, false)
  on conflict (channel_id, user_id) do update set hidden = false;
end;
$$;

create or replace function public.community__set_member(p_channel uuid, p_user uuid, p_action text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_c record;
  v_staff boolean;
  v_eligible boolean;
  v_before boolean;
  v_after boolean;
begin
  if p_channel is null or p_user is null then
    return false;
  end if;
  if p_action is null or p_action not in ('add', 'remove', 'reset') then
    raise exception '操作の指定が不正です。' using errcode = '22023';
  end if;
  select c.kind, c.visibility, c.audience, c.audience_plan_codes, c.audience_horse_ids
    into v_c
  from public.community_channels c where c.id = p_channel;
  if not found or v_c.kind <> 'channel' then
    raise exception 'チャンネルが見つかりません。' using errcode = 'P0002';
  end if;

  v_staff := public.community__is_staff(p_user);
  select coalesce((select v.is_joined from public.community__visible_channels(p_user) v where v.id = p_channel), false)
    into v_before;

  if p_action = 'add' then
    if not public.community__is_active_user(p_user) then
      return false;
    end if;
    -- 対象者に当てはまる人（と運営）は、手動の指定を消して参加中にするだけでよい
    v_eligible := v_staff or (
      v_c.visibility = 'public'
      and public.community__eligible(p_user, v_c.audience, v_c.audience_plan_codes, v_c.audience_horse_ids)
    );
    insert into public.community_channel_members (channel_id, user_id, hidden, access)
    values (p_channel, p_user, false, case when v_eligible then null else 'granted' end)
    on conflict (channel_id, user_id) do update
      set hidden = false, access = excluded.access;
  elsif p_action = 'remove' then
    if v_c.visibility = 'private' then
      delete from public.community_channel_members m
      where m.channel_id = p_channel and m.user_id = p_user;
    else
      -- 運営のアカウントは常に閲覧できるため、メンバーの一覧から外すだけ（退出と同じ）
      insert into public.community_channel_members (channel_id, user_id, hidden, access)
      values (p_channel, p_user, true, case when v_staff then null else 'removed' end)
      on conflict (channel_id, user_id) do update
        set hidden = true, access = excluded.access;
    end if;
  else
    update public.community_channel_members m
      set access = null, hidden = false
    where m.channel_id = p_channel and m.user_id = p_user and m.access is not null;
  end if;

  select coalesce((select v.is_joined from public.community__visible_channels(p_user) v where v.id = p_channel), false)
    into v_after;
  return v_after is distinct from v_before;
end;
$$;

create or replace function public.community_admin_set_members(p_channel uuid, p_users uuid[], p_action text)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_count integer := 0;
begin
  for v_user in
    select distinct u.id
    from unnest(coalesce(p_users, '{}'::uuid[])) as u(id)
    where u.id is not null
    limit 500
  loop
    if public.community__set_member(p_channel, v_user, p_action) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
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
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select c.kind, c.is_archived into v_c
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
    -- すでにメンバーの人は数えない（追加した人数だけを返す）
    if public.community__set_member(p_channel, v_member, 'add') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

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
  if v_c.visibility <> 'private' and not public.community__is_staff(v_uid) then
    raise exception '公開チャンネルからメンバーを外せるのは運営のみです。' using errcode = '42501';
  end if;
  perform public.community__set_member(p_channel, p_user, 'remove');
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
      and m.access is distinct from 'removed'
      -- 無料会員は、運営が追加した場合とお知らせを除き、メンバーに数えない（閲覧できないため）
      and (p.is_staff or m.access = 'granted' or v_c.category = 'announcement' or p.codes <> array['FREE']::text[]);
  else
    select coalesce(array_agg(p.user_id), '{}'::uuid[]) into v_ids
    from public.community__member_pool() p
    left join public.community_channel_members m
      on m.channel_id = p_channel and m.user_id = p.user_id
    -- 運営が外した人は含めない
    where m.access is distinct from 'removed'
      and (
        -- 運営が追加した人
        (m.access = 'granted' and not m.hidden)
        -- 対象者（参加している人。自動参加のチャンネルは、退出していない人）
        or (
          (
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
            when v_c.auto_join then not coalesce(m.hidden, false)
            else m.user_id is not null and not m.hidden
          end
        )
      );
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
begin
  if v_uid is null or not public.community__is_member(v_uid) then
    raise exception 'コミュニティを利用できません。' using errcode = '42501';
  end if;
  -- メンバーを追加できるのは運営のみ
  if not public.community__is_staff(v_uid) then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(left(v_q, 50), '\', '\\'), '%', '\%'), '_', '\_') || '%';

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
  where u.uid <> v_uid
    and (
      v_q = ''
      or cp.display_name ilike v_pattern
      or u.real_name ilike v_pattern
      or u.kana ilike v_pattern
      or u.username ilike v_pattern
    )
    and (
      p_channel is null
      or not exists (
        select 1 from public.community_channel_members m
        where m.channel_id = p_channel and m.user_id = u.uid and not m.hidden
          and m.access is distinct from 'removed'
      )
    )
    and public.community__is_active_user(u.uid)
    and not exists (select 1 from public.community_hidden_users h where h.user_id = u.uid)
  order by public.community__is_staff(u.uid) desc,
           coalesce(cp.display_name, u.username, u.real_name)
  limit 30;
end;
$$;

create or replace function public.community_set_dm_label(p_channel uuid, p_label text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  if not public.community__is_staff(v_uid) then
    raise exception 'ダイレクトメッセージの名前を変更できるのは運営のみです。' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.community_channels c
    join public.community_channel_members m on m.channel_id = c.id and m.user_id = v_uid
    where c.id = p_channel and c.kind = 'dm'
  ) then
    raise exception 'ダイレクトメッセージが見つかりません。' using errcode = 'P0002';
  end if;
  if v_label is not null and char_length(v_label) > 60 then
    raise exception '名前は60文字以内で入力してください。' using errcode = '22023';
  end if;

  if v_label is null then
    delete from public.community_dm_labels l
    where l.channel_id = p_channel and l.user_id = v_uid;
  else
    insert into public.community_dm_labels (channel_id, user_id, label, updated_at)
    values (p_channel, v_uid, v_label, now())
    on conflict (channel_id, user_id) do update
      set label = excluded.label, updated_at = now();
  end if;
  return v_label;
end;
$$;

-- 戻り値の列（label）を増やしたため、古い定義を削除してから作り直す。
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
  member_count integer,
  label text
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
    coalesce(mc.member_count, 0),
    -- DM に自分で付けた名前（運営のみ付けられる。相手には見えない）
    dl.label
  from vis s
  left join public.community_dm_labels dl
    on dl.channel_id = s.id and dl.user_id = v_uid
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

-- ---------------------------------------------------------------------
-- 関数の実行権限（作り直した関数・新しい関数）
-- ---------------------------------------------------------------------
revoke all on function public.community__set_member(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.community_admin_set_members(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.community_admin_set_members(uuid, uuid[], text) to service_role;

revoke all on function public.community_list_channels() from public, anon;
grant execute on function public.community_list_channels() to authenticated, service_role;
revoke all on function public.community_set_dm_label(uuid, text) from public, anon;
grant execute on function public.community_set_dm_label(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- チャンネルの設定: 「みんなの広場」を全会員（無料会員を含む）に表示する
-- ---------------------------------------------------------------------
update public.community_channels c
  set audience = 'all', audience_plan_codes = '{}'
where c.kind = 'channel' and c.name = 'みんなの広場'
  and c.visibility = 'public' and c.audience = 'plans';

-- API（PostgREST）に、増えた関数と戻り値の列を読み込ませる
notify pgrst, 'reload schema';
