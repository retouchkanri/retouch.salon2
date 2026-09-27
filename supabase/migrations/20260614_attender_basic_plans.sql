-- =====================================================================
-- 基本会員プラン名の整理（アテンダー / メンバーズ / サポーター / リェリーフ）
--
-- 背景: 管理画面の手動登録で「アテンダー会員」が選択肢に無かった。
--   旧 import ではアテンダーとメンバーズが同一プラン(A/¥1,800)に統合され、
--   A の表示名が「メンバーズ会員」になっていた。
--
-- 方針:
--   A ¥1,800 → アテンダー会員（既存 active A を改名）
--   B ¥3,600 → サポーター会員（既存のまま）＋ メンバーズ会員（新規追加）
--   C ¥7,200 → リェリーフ会員（既存のまま）
-- =====================================================================

update public.membership_plans
set name = 'アテンダー会員',
    description = '月額1,800円のアテンダー会員プラン',
    updated_at = now()
where code = 'A'
  and is_active = true
  and name = 'メンバーズ会員';

insert into public.membership_plans (
  code, name, monthly_amount, unit_amount,
  allow_with_support, allow_with_team, sort_order, description, is_active
)
select
  'B', 'メンバーズ会員', 3600, null,
  false, true, 15, '月額3,600円のメンバーズ会員プラン', true
where not exists (
  select 1 from public.membership_plans
  where code = 'B' and name = 'メンバーズ会員' and is_active = true
);
