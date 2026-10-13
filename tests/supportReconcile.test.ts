import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileSupport, type ReconcileCustomer, type StripeSupportPayer } from "../src/lib/supportReconcile";
import { summarizeLivePayers, summarizeLiveSupport, type LiveItem } from "../src/lib/stripeLive";

const customer = (id: string, stripe: string | null = null, email: string | null = `${id}@x.jp`): ReconcileCustomer => ({ id, full_name: `会員${id}`, email, stripe_customer_id: stripe });
const payer = (email: string | null, ids: string[], units: number, pastDueUnits = 0): StripeSupportPayer => ({ email, stripeCustomerIds: ids, units, pastDueUnits });

test("supporters whose registration and Stripe charge agree are not listed", () => {
  const result = reconcileSupport(
    [{ customer_id: "a", units: 1 }, { customer_id: "a", units: 0.5 }, { customer_id: "b", units: "2" }],
    [payer("a@x.jp", ["cus_a"], 1.5), payer("b@x.jp", ["cus_b"], 2)],
    [customer("a", "cus_a"), customer("b", "cus_b")],
  );
  assert.deepEqual(result.site, { supporters: 2, units: 3.5 });
  assert.deepEqual(result.stripe, { supporters: 2, units: 3.5 });
  assert.equal(result.billedUnits, 3.5);
  assert.equal(result.unbilledUnits, 0);
  assert.deepEqual(result.mismatches, []);
});

test("each kind of difference is listed with both figures, and the totals add up", () => {
  const result = reconcileSupport(
    [
      { customer_id: "bank", units: 2 }, // 銀行振込：Stripe の課金なし
      { customer_id: "more", units: 3 }, // サイト 3口、Stripe 2.5口
      { customer_id: "less", units: 1 }, // サイト 1口、Stripe 2口
      { customer_id: "late", units: 1 }, // Stripe では支払い遅延だけ
      { customer_id: "same", units: 0.5 },
    ],
    [
      payer("more@x.jp", ["cus_more"], 2.5),
      payer("less@x.jp", ["cus_less"], 2),
      payer("late@x.jp", ["cus_late"], 0, 1),
      payer("same@x.jp", ["cus_same"], 0.5),
      payer("gone@x.jp", ["cus_gone"], 1.5), // サイトでは停止済み
      payer("stranger@x.jp", ["cus_x"], 1), // サイトの顧客に結び付かない
    ],
    [customer("bank"), customer("more", "cus_more"), customer("less", "cus_less"), customer("late", "cus_late"), customer("same", "cus_same"), customer("gone", "cus_gone")],
  );
  assert.deepEqual(result.site, { supporters: 5, units: 7.5 });
  assert.deepEqual(result.stripe, { supporters: 5, units: 7.5 });
  // 登録 7.5口のうち、課金されているのは more 2.5 + less 1 + same 0.5 = 4口。
  assert.equal(result.billedUnits, 4);
  assert.equal(result.unbilledUnits, 3.5);
  const byName = Object.fromEntries(result.mismatches.map((row) => [row.name, row]));
  assert.equal(result.mismatches.length, 6);
  assert.deepEqual([byName["会員bank"].kind, byName["会員bank"].siteUnits, byName["会員bank"].stripeUnits], ["site_only", 2, 0]);
  assert.deepEqual([byName["会員more"].kind, byName["会員more"].siteUnits, byName["会員more"].stripeUnits], ["site_more", 3, 2.5]);
  assert.deepEqual([byName["会員less"].kind, byName["会員less"].siteUnits, byName["会員less"].stripeUnits], ["stripe_more", 1, 2]);
  assert.deepEqual([byName["会員late"].kind, byName["会員late"].pastDueUnits], ["site_only", 1]);
  assert.deepEqual([byName["会員gone"].kind, byName["会員gone"].customerId], ["stripe_only", "gone"]);
  assert.deepEqual([byName["（サイトに顧客なし）"].kind, byName["（サイトに顧客なし）"].customerId, byName["（サイトに顧客なし）"].email], ["stripe_only", null, "stranger@x.jp"]);
  // 課金されているのに登録のない人が先に並ぶ。
  assert.deepEqual(result.mismatches.slice(0, 2).map((row) => row.kind), ["stripe_only", "stripe_only"]);
  // 差の合計は、サイト − Stripe と一致する。
  const net = result.mismatches.reduce((sum, row) => sum + row.siteUnits - row.stripeUnits, 0);
  assert.equal(net, result.site.units - result.stripe.units);
});

test("a Stripe payer is tied to the site customer by Stripe customer id first, then by e-mail address", () => {
  const result = reconcileSupport(
    [{ customer_id: "a", units: 1 }, { customer_id: "b", units: 1 }],
    [
      // 旧サイトの別メールアドレスだが、Stripe の顧客IDが同じ
      payer("old-address@x.jp", ["cus_a"], 1),
      // 顧客IDは登録されていないが、メールアドレスが同じ（大文字小文字は無視）
      payer("B@X.JP", ["cus_other"], 1),
    ],
    [customer("a", "cus_a"), customer("b", null)],
  );
  assert.deepEqual(result.mismatches, []);
});

test("Stripe subscription items are grouped per payer, paying and overdue apart", () => {
  const items: LiveItem[] = [
    { status: "active", customer: "a@x.jp", productName: "１口支援馬会員", monthlyYen: 12000, email: "a@x.jp", stripeCustomerId: "cus_1" },
    // 同じ人の、別の Stripe 顧客での半口
    { status: "active", customer: "a@x.jp", productName: "半口支援馬会員（追加）", monthlyYen: 6000, email: "a@x.jp", stripeCustomerId: "cus_2" },
    { status: "past_due", customer: "b@x.jp", productName: "２口支援馬会員", monthlyYen: 24000, email: "b@x.jp", stripeCustomerId: "cus_3" },
    // 一口支援ではない定期課金と、終了した定期課金は数えない
    { status: "active", customer: "a@x.jp", productName: "メンバーズ会員", monthlyYen: 1800, email: "a@x.jp", stripeCustomerId: "cus_1" },
    { status: "canceled", customer: "c@x.jp", productName: "１口支援馬会員", monthlyYen: 12000, email: "c@x.jp", stripeCustomerId: "cus_4" },
  ];
  const payers = summarizeLivePayers(items);
  assert.deepEqual(payers, [
    { email: "a@x.jp", stripeCustomerIds: ["cus_1", "cus_2"], units: 1.5, pastDueUnits: 0 },
    { email: "b@x.jp", stripeCustomerIds: ["cus_3"], units: 0, pastDueUnits: 2 },
  ]);
  // 合計は、これまでの集計と同じ。
  const summary = summarizeLiveSupport(items, "2026-10");
  assert.deepEqual([summary.yen, summary.supporters, summary.units, summary.pastDueYen], [18000, 1, 1.5, 24000]);
});
