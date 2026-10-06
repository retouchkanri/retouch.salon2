import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalPayments } from "../src/lib/paymentRows";
import { summarizeLiveSupport } from "../src/lib/stripeLive";

test("a payment recorded by the webhook and by the Stripe sync is listed once", () => {
  const rows = [
    // 請求 in_1：Webhook の控えと、同期が入れた決済の行
    { id: "w1", status: "succeeded", stripe_event_id: "evt_1", stripe_invoice_id: "in_1" },
    { id: "s1", status: "succeeded", stripe_charge_id: "ch_1", stripe_invoice_id: "in_1" },
    // 請求 in_2：1回目は失敗、再決済で成功。Stripe では2件の支払いなので2行残る。
    { id: "w2a", status: "failed", stripe_event_id: "evt_2", stripe_invoice_id: "in_2" },
    { id: "s2a", status: "failed", stripe_charge_id: "ch_2", stripe_invoice_id: "in_2" },
    { id: "w2b", status: "succeeded", stripe_event_id: "evt_3", stripe_invoice_id: "in_2" },
    { id: "s2b", status: "succeeded", stripe_charge_id: "ch_3", stripe_invoice_id: "in_2" },
    // 請求 in_3：返金済み。Webhook の控えは「成功」のままでも、同じ支払い。
    { id: "w3", status: "succeeded", stripe_event_id: "evt_4", stripe_invoice_id: "in_3" },
    { id: "s3", status: "refunded", stripe_charge_id: "ch_4", stripe_invoice_id: "in_3" },
    // 支払った直後で、同期がまだ追いついていない請求。控えの行しか無いので消さない。
    { id: "w4", status: "succeeded", stripe_event_id: "evt_5", stripe_invoice_id: "in_4" },
    // 失敗した決済の行だけがあり、成功は Webhook の控えにしか無い。成功を消さない。
    { id: "s5", status: "failed", stripe_charge_id: "ch_5", stripe_invoice_id: "in_5" },
    { id: "w5", status: "succeeded", stripe_event_id: "evt_6", stripe_invoice_id: "in_5" },
    // カードの寄付：Webhook の行と、同期が入れた行
    { id: "d1", status: "succeeded", stripe_event_id: "evt_7", stripe_payment_intent_id: "pi_1" },
    { id: "o1", status: "succeeded", stripe_charge_id: "ch_6", stripe_payment_intent_id: "pi_1" },
    // 銀行振込の寄付を手で入金済みにした行
    { id: "m1", status: "succeeded" },
  ];
  assert.deepEqual(
    canonicalPayments(rows).map((row) => row.id),
    ["s1", "s2a", "s2b", "s3", "w4", "s5", "w5", "o1", "m1"],
  );
});

test("live support counts paying subscriptions and keeps late ones apart", () => {
  const live = summarizeLiveSupport(
    [
      { status: "active", customer: "cus_1", productName: "１口支援馬会員", monthlyYen: 12000 },
      { status: "active", customer: "cus_1", productName: "半口支援馬会員（追加）", monthlyYen: 6000 },
      { status: "active", customer: "cus_2", productName: "Retouchメンバーズ 支援（半口単位）", monthlyYen: 18000 },
      { status: "past_due", customer: "cus_3", productName: "１口支援馬会員", monthlyYen: 12000 },
      // 会費やチームは一口支援ではない
      { status: "active", customer: "cus_4", productName: "メンバーズ会員", monthlyYen: 1800 },
      { status: "active", customer: "cus_5", productName: "番外編　目が負傷のポニー救済支援チーム", monthlyYen: 1000 },
      { status: "canceled", customer: "cus_6", productName: "１口支援馬会員", monthlyYen: 12000 },
    ],
    "2026-10",
  );
  assert.deepEqual(live, { ym: "2026-10", yen: 36000, supporters: 2, units: 3, pastDueYen: 12000 });
});
