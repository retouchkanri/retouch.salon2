-- =====================================================================
-- 寄付一覧の照合用フィールド追加（銀行振込の手動管理に対応）
--   - payment_method : 支払方法（card / bank_transfer）。既定は card。
--                      サイトのStripe決済は card のまま、銀行振込は手動で
--                      bank_transfer を登録する運用。
--   - confirmed_at   : 入金確認日（銀行振込の着金確認日など）。
--   - note           : 備考（管理用メモ。寄付者の message とは別）。
--   冪等（再実行可能）。既存行は payment_method='card' になる。
-- =====================================================================

alter table public.donations
  add column if not exists payment_method text not null default 'card';

alter table public.donations drop constraint if exists donations_payment_method_check;
alter table public.donations
  add constraint donations_payment_method_check
  check (payment_method in ('card', 'bank_transfer'));

alter table public.donations
  add column if not exists confirmed_at timestamptz;

alter table public.donations
  add column if not exists note text;
