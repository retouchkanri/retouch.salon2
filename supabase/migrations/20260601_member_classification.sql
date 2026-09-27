-- =====================================================================
-- 会員種別の整理（要件 #2）
--   顧客一覧を「会員種別 / 支援数 / 特別参加」の3区分に整理する。
--   1) special_team_memberships に team_name（チーム名）を追加。
--      例: 目の負傷「ガンガン支援チーム」を別表示・タグ表示できるようにする。
--   2) v_customer_summary を作り直し、
--        - member_class_code: 基本会員区分のみ（A/B/C、無ければ支援馬会員=SUPPORT）
--        - total_support_units / total_support_horses: 口数・頭数
--        - rpt_active / special_team_count / special_team_names: 特別参加（タグ）
--      を返すようにする。RPT・特別チームは「会員種別」から除外し、
--      「特別参加」へ寄せることで、基本区分と追加参加が混ざらないようにする。
-- =====================================================================

-- 1) チーム名カラム --------------------------------------------------
alter table public.special_team_memberships
  add column if not exists team_name text;

-- 2) 顧客サマリービュー ---------------------------------------------
-- 列の追加・並び替えを伴うため create or replace では置換できない（42P16）。
-- 一旦 drop してから作り直す。
drop view if exists public.v_customer_summary;
create view public.v_customer_summary as
select
  c.id as customer_id,
  c.full_name,
  c.email,
  c.status,
  c.avatar_url,
  -- 基本会員区分（A/B/C のみ。RPT・特別チームは含めない）
  basic_plan.plan_code as primary_plan_code,
  basic_plan.plan_name as primary_plan_name,
  -- 会員種別コード: 基本契約(A/B/C) > 無ければ支援(SUPPORT) > 無ければ null
  coalesce(
    basic_plan.plan_code::text,
    case when coalesce(support_agg.horse_count, 0) > 0 then 'SUPPORT' end
  ) as member_class_code,
  -- 支援数
  coalesce(support_agg.total_units, 0)   as total_support_units,
  coalesce(support_agg.horse_count, 0)   as total_support_horses,
  coalesce(support_agg.monthly_total, 0) as monthly_total,
  contract_agg.current_period_end as next_payment_at,
  contract_agg.contract_status as contract_status,
  -- 特別参加
  coalesce(rpt_agg.active, false) as rpt_active,
  coalesce(team_agg.team_count, 0) as special_team_count,
  team_agg.team_names as special_team_names
from public.customers c
-- 基本会員区分（最新の有効 A/B/C 契約を1件）
left join lateral (
  select mp.code as plan_code, mp.name as plan_name
  from public.contracts ct
  join public.membership_plans mp on mp.id = ct.plan_id
  where ct.customer_id = c.id and ct.status = 'active'
    and mp.code in ('A', 'B', 'C')
  order by ct.started_at desc limit 1
) basic_plan on true
-- 支援（口数・頭数・月額）
left join lateral (
  select
    sum(ss.units) as total_units,
    count(distinct ss.horse_id) as horse_count,
    sum(ss.monthly_amount) as monthly_total
  from public.support_subscriptions ss
  where ss.customer_id = c.id and ss.status = 'active'
) support_agg on true
-- リタポ（RPT）: 有効な契約があるか
left join lateral (
  select bool_or(ct.status = 'active') as active
  from public.contracts ct
  join public.membership_plans mp on mp.id = ct.plan_id
  where ct.customer_id = c.id and ct.status = 'active' and mp.code = 'RPT'
) rpt_agg on true
-- 特別チーム: 件数とチーム名（未設定の場合は馬名で代替）
left join lateral (
  select
    count(*) as team_count,
    array_agg(distinct coalesce(nullif(st.team_name, ''), h.name))
      filter (where st.horse_id is not null or st.team_name is not null) as team_names
  from public.special_team_memberships st
  left join public.horses h on h.id = st.horse_id
  where st.customer_id = c.id and st.status = 'active'
) team_agg on true
-- 次回決済日 / 決済状態（全契約から最新）
left join lateral (
  select current_period_end, status::text as contract_status
  from public.contracts ct
  where ct.customer_id = c.id
  order by current_period_end desc nulls last limit 1
) contract_agg on true;
