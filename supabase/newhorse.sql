-- =====================================================================
-- 緊急支援募集馬（57〜60番）管理用スクリプト
--
-- 対象:
--   57：緊急支援募集馬（現在の写真を追加）
--   58：緊急支援募集馬（牝馬）
--   59：緊急支援募集馬（仔馬）※新規追加
--   60：緊急支援募集馬（白いどさんこ）※新規追加
--
-- 画像は Supabase Storage の avatars バケット horses/ 配下にアップロード済み
-- （scripts/apply-emergency-horses-59-60.mjs で実行）。
-- このファイルは同じ内容を SQL として保持し、再実行しても安全（idempotent）。
-- =====================================================================

-- 57・58 は既存レコードなので画像・プロフィール・並び順のみ更新
update public.horses
set
  image_url = 'https://jdpsycypgdtewgdhlkkj.supabase.co/storage/v1/object/public/avatars/horses/57-emergency.jpg',
  profile = '大阪から千葉への移動を控えている57番目の子★支援募集開始★',
  is_emergency_recruitment = true,
  is_supportable = true,
  sort_order = -9
where name = '57：緊急支援募集馬';

update public.horses
set
  image_url = 'https://jdpsycypgdtewgdhlkkj.supabase.co/storage/v1/object/public/avatars/horses/58-emergency.jpg',
  profile = '大阪から千葉への移動を控えている58番目の子（牝馬）★支援募集開始★',
  is_emergency_recruitment = true,
  is_supportable = true,
  sort_order = -8
where name = '58：緊急支援募集馬';

-- 59・60 は新規追加（既に存在する場合は追加しない）
insert into public.horses (name, name_kana, profile, image_url, is_supportable, is_emergency_recruitment, sort_order)
select v.name, v.kana, v.profile, v.image_url, true, true, v.ord
from (values
  (
    '59：緊急支援募集馬',
    '59キンキュウシエンボシュウウマ',
    '大阪から千葉への移動を控えている59番目の子（仔馬）★支援募集開始★',
    'https://jdpsycypgdtewgdhlkkj.supabase.co/storage/v1/object/public/avatars/horses/59-emergency.jpg',
    -7
  ),
  (
    '60：緊急支援募集馬',
    '60キンキュウシエンボシュウウマ',
    '大阪から千葉への移動を控えている60番目の子（白いどさんこ）★支援募集開始★',
    'https://jdpsycypgdtewgdhlkkj.supabase.co/storage/v1/object/public/avatars/horses/60-emergency.jpg',
    -6
  )
) as v(name, kana, profile, image_url, ord)
where not exists (select 1 from public.horses h where h.name = v.name);

-- =====================================================================
-- 支援決済トラブル対応（snow55pixie@gmail.com / 山内様）2026-08-27
--
-- 症状: 4月から1口支援中の会員が7月にカードを変更したが、引き落としが
--       いつまでも反映されない、というお問い合わせ。
--
-- 原因: この会員の3件の支援（33:マリア ¥12,000 / 41:ルル ¥6,000 /
--       44:ラテ ¥6,000）は、実際には一度も Stripe のサブスクリプションに
--       紐付けられておらず（contracts.stripe_subscription_id が null）、
--       実際の請求は 2025年に作成された、現在の会員レコードとは無関係の
--       3つの Stripe 顧客（別カスタマーID）上で個別に動いていた。会員が
--       マイページ経由でカードを更新しても、その更新は今のアカウントの
--       Stripeカスタマーにしか反映されず、実際に課金していた古い3件には
--       決して届かなかった。古いカード（末尾8927）へのリトライが繰り返され、
--       Stripe側で自動的にサブスクリプションが解約されていた。
--
-- 対応: scripts/fix-snow55pixie-support.mjs を実行し、現在のStripe顧客
--       （cus_UmNqNdX8UOttyO）上に新しいサブスクリプション
--       （sub_1U90O3I78wDNWYHlpt5kiIUC）を作成し、3件の支援を紐付け直した。
--       Stripe側の「Link」経由で保存されたカードは、初回の自動（不在時）
--       課金の前に一度だけ本人によるオンセッション確認が必要なため、
--       現在 subscription/support は "incomplete" 状態。会員に決済リンクを
--       送付し、確認していただき次第、Webhook経由で自動的に有効化される。
--
-- 決済リンク（会員に送付）:
--   https://invoice.stripe.com/i/acct_1IXMJrI78wDNWYHl/live_YWNjdF8xSVhNSnJJNzh3RE5XWUhsLF9WOUowZ09WSExjR2FsNXpadTdNUzV5Mm05QlRqbG5hLDE3ODM2NjcwNA0200jYnHnIlx?s=ap
--
-- 冪等性: 既に stripe_subscription_id が設定されている場合は何もしない。
-- =====================================================================
update public.contracts
set
  stripe_subscription_id = 'sub_1U90O3I78wDNWYHlpt5kiIUC',
  status = 'incomplete',
  current_period_end = '2026-09-27T10:18:23+00:00'
where id = '003f58d0-9c00-4698-acac-d4851a1bf804'
  and stripe_subscription_id is null;

update public.support_subscriptions
set stripe_subscription_item_id = 'si_V9J0loGuQ9o3cF'
where id = 'f48d1c5f-3ee3-4c47-9877-c9e83015e7bb'
  and stripe_subscription_item_id is null;

update public.support_subscriptions
set stripe_subscription_item_id = 'si_V9J0cJ2ogzTrpD'
where id = '57a650ef-73e3-4c3b-bc18-a43d58399865'
  and stripe_subscription_item_id is null;

update public.support_subscriptions
set stripe_subscription_item_id = 'si_V9J0U2E2uGMAX8'
where id = 'b9d4a151-f0fb-4563-84f5-fc1a5411a0f7'
  and stripe_subscription_item_id is null;

-- =====================================================================
-- 支援変更エラー再発対応（溝口智子様）2026-08-27
--
-- 症状: 既存1口支援中の 25:ラファ・44:ラテ を半口に変更しようとすると、
--       「No such subscription: sub_1U8onYI78wDNWYHlOwHu44gy」「You cannot
--       update a subscription that is `incomplete_expired`.」というエラーが
--       表示され変更できない（8/21に一度修正依頼済みの箇所の再発）。
--
-- 原因: 8/21〜8/26にかけての変更試行の過程で、この会員の最も古い契約
--       （contracts.id=4f2809e6-114c-4a4f-aaf2-22fcb013a49e／23:アンジュ・
--       25:ラファ・24:ヒナタ・44:ラテの4頭、各¥12,000）に対して自動で
--       新規Stripeサブスクリプションが作成されたが、初回請求の
--       PaymentIntentが `payment_behavior: default_incomplete` のまま
--       確認（confirm）されずに放置され、約23時間後にStripe側で
--       `incomplete_expired` へ自動失効。Stripeの
--       `customer.subscription.deleted` Webhookでcontract/support側も
--       まとめて status=canceled にカスケードされた。
--       以後、このサブスクリプションIDを参照するあらゆる編集操作が
--       「存在しないサブスクリプション」または「incomplete_expiredは
--       更新不可」という生のStripeエラーで失敗するようになっていた。
--
-- 対応: scripts/fix-mizoguchi-support.mjs を実行し、会員の有効なカード
--       （pm_1U6n2tI78wDNWYHleb1vfIBY／Visa ...6301、Linkではない通常
--       カード）を明示指定して新しいサブスクリプション
--       （sub_1U90mGI78wDNWYHl5pD85bzY）を作成。初回請求の
--       PaymentIntentをオンセッション相当（off_session未指定）で即時
--       confirmし、会員の追加操作なしで ¥48,000 の課金・有効化に成功。
--       4頭すべてを新サブスクリプションのアイテムに紐付け直した。
--       なお、未デプロイのWebhookが旧ロジック（subscription_id upsert）
--       のままだったため、新サブスクリプション作成時に重複した空の
--       contract行（plan_id=null）が作られており、これは依存レコードが
--       ないことを確認の上、削除済み。
--
-- 恒久対応（コード側）: src/lib/stripeSupport.ts / 
--       src/app/api/mypage/supports/[id]/route.ts に、
--       (1) 新規サブスクリプション作成後にPaymentIntentを自動confirmし、
--           可能な限りその場で有効化する、
--       (2) 契約のstripe_subscription_idが実際には失効/削除済みの場合、
--           それを「まだサブスクリプションがない」状態として扱い、
--           新規作成で自己修復する、
--       (3) 支援停止（stop）でも失効済みサブスクリプションをエラーにせず
--           「既に解約済み」として扱う、
--       という改修を追加済み（デプロイ承認待ち）。
--
-- 冪等性: 既に stripe_subscription_id が設定されている場合は何もしない。
-- =====================================================================
update public.contracts
set
  stripe_subscription_id = 'sub_1U90mGI78wDNWYHl5pD85bzY',
  status = 'active',
  canceled_at = null,
  current_period_end = '2026-09-27T10:43:24+00:00'
where id = '4f2809e6-114c-4a4f-aaf2-22fcb013a49e'
  and stripe_subscription_id in ('sub_1U8onYI78wDNWYHlOwHu44gy');

update public.support_subscriptions
set stripe_subscription_item_id = 'si_V9JP6DXf83ROBP', status = 'active', canceled_at = null
where id = '2b536a6c-bf7e-4d33-bbf3-3f79f364247c'
  and stripe_subscription_item_id is null;

update public.support_subscriptions
set stripe_subscription_item_id = 'si_V9JPdmeJNLWclO', status = 'active', canceled_at = null
where id = '6974817b-c49b-4c2d-bb40-9771565ff03f'
  and stripe_subscription_item_id = 'si_V971a8wwwgUFgn';

update public.support_subscriptions
set stripe_subscription_item_id = 'si_V9JPnrHGtE03Pk', status = 'active', canceled_at = null
where id = 'fd051846-dd42-4dba-9d1f-420123c72500'
  and stripe_subscription_item_id is null;

update public.support_subscriptions
set stripe_subscription_item_id = 'si_V9JPkaYk2pBLkr', status = 'active', canceled_at = null
where id = 'ac665424-7f79-47de-9971-86a87a335462'
  and stripe_subscription_item_id is null;
