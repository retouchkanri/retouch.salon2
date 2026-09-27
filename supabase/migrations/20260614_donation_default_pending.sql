-- =====================================================================
-- 寄付の既定状態を「保留」に変更
--
-- 背景: インポート時に銀行振込寄付が自動で「成功」+ 入金確認日付きになっていた。
--   新規寄付も DB/API の既定が succeeded だった。
-- 方針:
--   - 既定 status → pending
--   - 銀行振込で入金確認前の succeeded 行を pending に戻す
--   - 対応する payments 行（未確認の寄付分）を削除
-- =====================================================================

alter table public.donations
  alter column status set default 'pending';

-- 銀行振込かつ入金未確認（confirmed_at が NULL）の成功行を保留へ
update public.donations
set status = 'pending'
where payment_method = 'bank_transfer'
  and status = 'succeeded'
  and confirmed_at is null;

-- インポート時に donated_at と同じ日付が自動入力されていた行も保留へ
update public.donations d
set status = 'pending',
    confirmed_at = null
where d.payment_method = 'bank_transfer'
  and d.status = 'succeeded'
  and d.confirmed_at is not null
  and d.confirmed_at = d.donated_at;

delete from public.payments p
where p.kind = 'donation'
  and p.donation_id in (
    select id from public.donations
    where payment_method = 'bank_transfer' and status = 'pending'
  );
