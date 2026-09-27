-- Aプランを「アテンダー会員」から「メンバーズ会員」に戻す
-- 背景: 6/14の移行でAプランがアテンダーに改名されたが、
--       手動でアテンダー設定するまでは全員メンバーズとして表示する。

UPDATE public.membership_plans
SET name        = 'メンバーズ会員',
    description = '月額1,800円のメンバーズ会員プラン',
    updated_at  = now()
WHERE code    = 'A'
  AND name    = 'アテンダー会員'
  AND is_active = true;

-- 6/14移行で追加された B「メンバーズ会員」¥3,600 プランを無効化
-- （Aがメンバーズに戻るため名称重複を避ける）
UPDATE public.membership_plans
SET is_active  = false,
    updated_at = now()
WHERE code           = 'B'
  AND name           = 'メンバーズ会員'
  AND monthly_amount = 3600;
