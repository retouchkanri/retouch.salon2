-- =====================================================================
-- 管理画面の「月額合計」に基本会費(A/B/C)を反映する
-- =====================================================================
-- 経緯:
--   v_customer_summary.monthly_total は従来 support_subscriptions（馬ごとの
--   支援額）のみを集計していたため、サポーター/メンバーズ/リェリーフ(A/B/C)
--   会員では会費が反映されず ¥0 と表示されていた。
--   マイページ側は「基本会費(A/B/C) + 馬ごとの支援額」を表示しているため、
--   管理画面と数値が一致しない状態だった。
--
-- 本マイグレーションでの変更点（monthly_total のみ。他の列は不変）:
--   1) basic_plan ラテラルで基本プラン(A/B/C)の monthly_amount を返す。
--   2) monthly_total = 馬ごとの支援額合計 + 基本会費(A/B/C)。
--
-- 方針（マイページの算出ロジックと一致させる）:
--   ・リタポ(RPT)・特別チーム(SPECIAL_TEAM)は「特別参加」タグであり合計に含めない。
--   ・ヘルパーズ(SUPPORT)の区分マーカー契約は会費として加算しない
--     （実額は support_subscriptions に計上済みのため二重計上を避ける）。
--   ・集計対象は status = 'active'（会員種別・支援数の判定と同一基準）。
--
-- 列構成は変更しないが、定義差し替えのため drop → create で作り直す。
-- =====================================================================

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
  coalesce(support_agg.total_units, 0)  as total_support_units,
  coalesce(support_agg.horse_count, 0)  as total_support_horses,
  -- 月額合計 = 馬ごとの支援額合計 + 基本会費(A/B/C)
  coalesce(support_agg.monthly_total, 0) + coalesce(basic_plan.plan_monthly, 0) as monthly_total,
  contract_agg.current_period_end as next_payment_at,
  contract_agg.contract_status as contract_status,
  -- 特別参加
  coalesce(rpt_agg.active, false) as rpt_active,
  coalesce(team_agg.team_count, 0) as special_team_count,
  team_agg.team_names as special_team_names
from public.customers c
left join lateral (
  select mp.code as plan_code, mp.name as plan_name, mp.monthly_amount as plan_monthly
  from public.contracts ct
  join public.membership_plans mp on mp.id = ct.plan_id
  where ct.customer_id = c.id and ct.status = 'active'
    and mp.code in ('A', 'B', 'C')
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
