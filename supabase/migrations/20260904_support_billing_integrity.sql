-- 2026-09-04: 支援（一口/半口）の二重請求を構造的に防ぐための整合性制約。
--
-- 背景（2026-09 報告の過剰請求）:
--   1. 会員が同じ馬に再申込すると、Stripe 側で解約済みなのに DB に残っていた
--      「ゾンビ行」に口数が加算され、半口が1口（数量2）として請求された。
--   2. 初回決済前（status='incomplete'）の行が「既存」と見なされず、リトライの
--      たびに同じ馬の行と Stripe subscription item が増殖した。
--   3. 運営が管理画面で口数変更・停止をしても Stripe を呼んでいなかったため、
--      DB と請求額が乖離した。
--
-- (3) はアプリ側で修正済み（すべての支援変更は stripeSupport.ts を経由）。
-- (1)(2) の再発は「1会員 × 1頭 につき、生きている支援行は最大1件」という
-- 部分ユニークインデックスで DB レベルからも封じる。
--
-- 注意: 既存の重複行が残っているとインデックスは作成できない。
--   先に `node scripts/audit-support-billing.mjs --fix` を実行して
--   Stripe と突き合わせたうえで重複を整理すること。
--   重複が残っている間は、このマイグレーションは NOTICE を出して
--   インデックス作成をスキップする（apply_all.sql を止めないため）。

do $$
declare
  dup_count integer;
  dup_sample text;
begin
  select count(*), coalesce(string_agg(sample, ', '), '')
    into dup_count, dup_sample
  from (
    select customer_id::text || '/' || horse_id::text as sample
    from public.support_subscriptions
    where status in ('active', 'past_due', 'incomplete')
    group by customer_id, horse_id
    having count(*) > 1
    limit 10
  ) d;

  if dup_count > 0 then
    raise notice
      '[skip] supports_one_live_per_customer_horse: 生存中の重複支援行が % 組あります (%). scripts/audit-support-billing.mjs --fix で整理後に再実行してください。',
      dup_count, dup_sample;
  else
    create unique index if not exists supports_one_live_per_customer_horse
      on public.support_subscriptions (customer_id, horse_id)
      where status in ('active', 'past_due', 'incomplete');
  end if;
end $$;

-- 同じ Stripe subscription item を2つの支援行が指していると、片方の口数変更が
-- もう片方の請求を書き換えてしまう。id が入っている行だけを対象に一意化する。
create unique index if not exists supports_unique_stripe_item
  on public.support_subscriptions (stripe_subscription_item_id)
  where stripe_subscription_item_id is not null;
