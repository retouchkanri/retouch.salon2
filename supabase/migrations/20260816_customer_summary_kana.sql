-- 顧客一覧の「氏名」列をあいうえお順（かな順）で並び替えできるようにするため、
-- v_customer_summary に customers.full_name_kana を追加する。
-- 列の追加を伴うため create or replace では置換できない（42P16）。drop してから作り直す。
-- 冪等（再実行可）。定義は 20260615_owners_member_plan.sql と同一（full_name_kana の追加のみ）。

drop view if exists public.v_customer_summary;
create view public.v_customer_summary as
select
  c.id as customer_id,
  c.full_name,
  c.full_name_kana,
  c.email,
  c.status,
  c.avatar_url,
  basic_plan.plan_code as primary_plan_code,
  basic_plan.plan_name as primary_plan_name,
  coalesce(
    basic_plan.plan_code::text,
    case when coalesce(support_agg.horse_count, 0) > 0 then 'SUPPORT' end
  ) as member_class_code,
  coalesce(support_agg.total_units, 0)  as total_support_units,
  coalesce(support_agg.horse_count, 0)  as total_support_horses,
  coalesce(support_agg.monthly_total, 0) + coalesce(basic_plan.plan_monthly, 0) as monthly_total,
  contract_agg.current_period_end as next_payment_at,
  contract_agg.contract_status as contract_status,
  coalesce(rpt_agg.active, false) as rpt_active,
  coalesce(team_agg.team_count, 0) as special_team_count,
  team_agg.team_names as special_team_names
from public.customers c
left join lateral (
  select mp.code as plan_code, mp.name as plan_name, mp.monthly_amount as plan_monthly
  from public.contracts ct
  join public.membership_plans mp on mp.id = ct.plan_id
  where ct.customer_id = c.id and ct.status = 'active'
    and mp.code::text in ('A', 'B', 'C', 'OWNER')
  order by ct.started_at desc limit 1
) basic_plan on true
left join lateral (
  select
    sum(ss.units) as total_units,
    count(distinct ss.horse_id) as horse_count,
    sum(ss.monthly_amount) as monthly_total
  from public.support_subscriptions ss
  where ss.customer_id = c.id and ss.status = 'active'
) support_agg on true
left join lateral (
  select bool_or(ct.status = 'active') as active
  from public.contracts ct
  join public.membership_plans mp on mp.id = ct.plan_id
  where ct.customer_id = c.id and ct.status = 'active' and mp.code = 'RPT'
) rpt_agg on true
left join lateral (
  select
    count(*) as team_count,
    array_agg(distinct coalesce(nullif(st.team_name, ''), h.name))
      filter (where st.horse_id is not null or st.team_name is not null) as team_names
  from public.special_team_memberships st
  left join public.horses h on h.id = st.horse_id
  where st.customer_id = c.id and st.status = 'active'
) team_agg on true
left join lateral (
  select current_period_end, status::text as contract_status
  from public.contracts ct
  where ct.customer_id = c.id
  order by current_period_end desc nulls last limit 1
) contract_agg on true;
