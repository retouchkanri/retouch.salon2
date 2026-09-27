-- =====================================================================
-- 決済履歴とStripeの実データを照合・同期するための列（要件 #4）
--   payments.stripe_charge_id : Stripeの charge ID。これを一意キーにして
--   Stripe→DB 同期を冪等（再実行しても重複しない）にする。
--   NULL は複数許容（既存行・Webhook由来行は charge_id を持たない場合がある）。
-- =====================================================================

alter table public.payments
  add column if not exists stripe_charge_id text;

-- 一意インデックス（NULL は Postgres 既定で互いに区別されるため複数可）。
-- upsert(onConflict: "stripe_charge_id") の競合解決に使用。
create unique index if not exists payments_stripe_charge_id_key
  on public.payments (stripe_charge_id);
