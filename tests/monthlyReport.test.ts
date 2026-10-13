import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOARDING_PER_HORSE_YEN,
  activeSupportNow,
  TREND_ROWS,
  buildCountHistory,
  buildMonthReport,
  changeRate,
  countHistoryTable,
  emptyAdjustments,
  expenseTotal,
  formatChange,
  hasIncomeAdjustments,
  incomeKindOfLine,
  managedHorseCount,
  monthStart,
  parseAdjustments,
  parseExpenses,
  stripeMonth,
  stripeReceipts,
  type ReportSource,
} from "../src/lib/monthlyReport";

function source(partial: Partial<ReportSource> = {}): ReportSource {
  return {
    customers: [],
    contracts: [],
    supports: [],
    horses: [],
    donations: [],
    payments: [],
    bookings: [],
    ...partial,
  };
}

test("month boundaries use Japan time", () => {
  assert.equal(monthStart(2026, 10).toISOString(), "2026-09-30T15:00:00.000Z");
});

test("change rate and blank previous month", () => {
  assert.equal(changeRate(103, 100), 3);
  assert.equal(changeRate(10, 0), null);
  assert.equal(formatChange(3), "+3.0%");
  assert.equal(formatChange(null), "—");
});

test("income splits 20 percent to operations and 80 percent to horse care", () => {
  const report = buildMonthReport(
    source({
      donations: [
        // カードの寄付は、Stripe の決済（下の payments）から数える。
        { amount: 10000, status: "succeeded", payment_method: "card", donated_at: "2026-10-05T00:00:00.000Z", confirmed_at: null, payment_intent_id: "pi_oct" },
        { amount: 5000, status: "succeeded", payment_method: "bank_transfer", donated_at: "2026-09-20T00:00:00.000Z", confirmed_at: "2026-10-08T00:00:00.000Z" },
        { amount: 99999, status: "pending", payment_method: "bank_transfer", donated_at: "2026-10-02T00:00:00.000Z", confirmed_at: null },
        { amount: 8000, status: "succeeded", payment_method: "card", donated_at: "2026-09-01T00:00:00.000Z", confirmed_at: null, payment_intent_id: "pi_sep" },
      ],
      contracts: [
        { id: "c1", customer_id: "u1", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "A" },
        { id: "c2", customer_id: "u2", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "SUPPORT" },
      ],
      payments: [
        { amount: 3000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "c1" },
        { amount: 12000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "c2" },
        { amount: 4000, status: "failed", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "c1" },
        { amount: 10000, status: "succeeded", kind: "donation", occurred_at: "2026-10-05T00:01:00.000Z", contract_id: null, payment_intent_id: "pi_oct", charge_id: "ch_oct" },
        { amount: 8000, status: "succeeded", kind: "donation", occurred_at: "2026-09-01T00:01:00.000Z", contract_id: null, payment_intent_id: "pi_sep", charge_id: "ch_sep" },
      ],
    }),
    "2026-10",
  );
  assert.ok(report);
  assert.equal(report.donations.card, 10000);
  assert.equal(report.donations.bank, 5000);
  assert.equal(report.donations.total, 15000);
  assert.equal(report.duesYen, 3000);
  assert.equal(report.shareIncomeYen, 12000);
  assert.equal(report.incomeYen, 30000);
  assert.equal(report.operatingYen, 6000);
  assert.equal(report.careYen, 24000);
});

test("membership classes, new members, withdrawals, and horse unit changes", () => {
  const report = buildMonthReport(
    source({
      customers: [
        { id: "free", email: "a@x.jp", status: "active", joined_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
        { id: "mem", email: "b@x.jp", status: "active", joined_at: "2026-10-03T00:00:00.000Z", created_at: "2026-10-03T00:00:00.000Z", updated_at: "2026-10-03T00:00:00.000Z" },
        { id: "sup", email: "c@x.jp", status: "active", joined_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
        { id: "rel", email: "d@x.jp", status: "active", joined_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
        { id: "left", email: "e@x.jp", status: "withdrawn", joined_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-10-15T00:00:00.000Z" },
        { id: "hidden", email: "kindman207@gmail.com", status: "active", joined_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
      ],
      contracts: [
        { id: "a", customer_id: "mem", started_at: "2026-10-03T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "A" },
        { id: "b", customer_id: "sup", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "B" },
        { id: "c", customer_id: "rel", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "C" },
      ],
      horses: [
        { id: "ume", name: "梅", created_at: "2020-01-01T00:00:00.000Z" },
        { id: "late", name: "桜（故）", created_at: "2020-01-01T00:00:00.000Z" },
      ],
      supports: [
        { customer_id: "free", horse_id: "ume", units: 2, monthly_amount: 24000, started_at: "2026-09-01T00:00:00.000Z", canceled_at: null, status: "active" },
        { customer_id: "sup", horse_id: "ume", units: 1, monthly_amount: 12000, started_at: "2026-10-02T00:00:00.000Z", canceled_at: null, status: "active" },
        { customer_id: "rel", horse_id: "late", units: 1, monthly_amount: 12000, started_at: "2026-01-01T00:00:00.000Z", canceled_at: "2026-10-01T00:00:00.000Z", status: "canceled" },
      ],
      hiddenEmails: ["kindman207@gmail.com"],
    }),
    "2026-10",
    null,
  );
  assert.ok(report);
  assert.equal(report.counts.free, 1);
  assert.equal(report.counts.members, 1);
  assert.equal(report.counts.supportersPlan, 1);
  assert.equal(report.counts.relief, 1);
  assert.equal(report.counts.total, 4);
  assert.equal(report.newMembers, 1);
  assert.equal(report.withdrawn, 1);
  assert.equal(report.counts.shareSupporters, 2);
  assert.equal(report.counts.shareUnits, 3);
  assert.equal(report.averageSupportYen, 18000);
  assert.equal(report.boardingHorses, 1);
  assert.equal(report.boardingYen, BOARDING_PER_HORSE_YEN);
  assert.equal(report.horsesUp[0]?.name, "梅");
  assert.equal(report.horsesUp[0]?.deltaUnits, 1);
  assert.equal(report.horsesDown[0]?.name, "桜（故）");
  assert.equal(report.horsesDown[0]?.deltaUnits, -1);
});

test("horse count override replaces the automatic boarding count", () => {
  const report = buildMonthReport(
    source({ horses: [{ id: "ume", name: "梅", created_at: "2020-01-01T00:00:00.000Z" }] }),
    "2026-10",
    4,
  );
  assert.equal(report?.boardingHorses, 4);
  assert.equal(report?.boardingYen, 4 * BOARDING_PER_HORSE_YEN);
});

test("expense fields ignore unknown and negative values", () => {
  const expenses = parseExpenses({ site: "1200", payment_fees: -5, extra: 99 });
  assert.equal(expenses.site, 1200);
  assert.equal(expenses.payment_fees, 0);
  assert.equal(expenseTotal(expenses), 1200);
});

test("an invoice recorded by both the webhook and the Stripe sync is counted once", () => {
  const report = buildMonthReport(
    source({
      contracts: [
        { id: "new", customer_id: "u1", started_at: "2026-07-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "A" },
      ],
      payments: [
        // 旧サイト時代からの契約。契約には紐付かないが、Webhook の請求明細で会費と分かる。
        { amount: 1800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:00.000Z", contract_id: null, invoice_id: "in_1", lines: [{ amount: 1800, kind: "dues" }] },
        { amount: 1800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:05.000Z", contract_id: null, invoice_id: "in_1" },
        // 会費と一口支援と特別チームが 1 枚の請求に載っている。
        { amount: 14800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-11T01:00:00.000Z", contract_id: null, invoice_id: "in_2", lines: [{ amount: 1800, kind: "dues" }, { amount: 12000, kind: "share" }, { amount: 1000, kind: "team" }] },
        { amount: 14800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-11T01:00:03.000Z", contract_id: null, invoice_id: "in_2" },
        // 1回目は失敗し、再決済で成功した請求。
        { amount: 12000, status: "failed", kind: "subscription", occurred_at: "2026-08-12T01:00:00.000Z", contract_id: null, invoice_id: "in_3", lines: [{ amount: 12000, kind: "share" }] },
        { amount: 12000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-14T01:00:00.000Z", contract_id: null, invoice_id: "in_3" },
        // 返金した請求は、Webhook の行が成功のままでも数えない。
        { amount: 3600, status: "succeeded", kind: "subscription", occurred_at: "2026-08-15T01:00:00.000Z", contract_id: null, invoice_id: "in_4", lines: [{ amount: 3600, kind: "dues" }] },
        { amount: 3600, status: "refunded", kind: "subscription", occurred_at: "2026-08-15T01:00:02.000Z", contract_id: null, invoice_id: "in_4" },
        // 明細がなく契約で分かる請求と、どちらもない請求。
        { amount: 1800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-16T01:00:00.000Z", contract_id: "new", invoice_id: "in_5" },
        { amount: 5000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-17T01:00:00.000Z", contract_id: null, invoice_id: "in_6" },
        // カードの単発寄付も、Webhook と同期の2行で入る。1 件として数える。
        { amount: 10000, status: "succeeded", kind: "donation", occurred_at: "2026-08-18T01:00:00.000Z", contract_id: null, payment_intent_id: "pi_1" },
        { amount: 10000, status: "succeeded", kind: "one_time", occurred_at: "2026-08-18T01:00:04.000Z", contract_id: null, payment_intent_id: "pi_1" },
        // 前の月の請求。
        { amount: 1800, status: "succeeded", kind: "subscription", occurred_at: "2026-07-10T01:00:00.000Z", contract_id: null, invoice_id: "in_0", lines: [{ amount: 1800, kind: "dues" }] },
      ],
    }),
    "2026-08",
  );
  assert.ok(report);
  assert.equal(report.duesYen, 1800 + 1800 + 1000 + 1800);
  assert.equal(report.teamIncomeYen, 1000);
  assert.equal(report.shareIncomeYen, 12000 + 12000);
  assert.equal(report.otherIncomeYen, 5000);
  assert.equal(report.donations.card, 10000);
  assert.equal(report.incomeYen, 6400 + 24000 + 5000 + 10000);
  assert.equal(report.operatingYen + report.careYen, report.incomeYen);
  // Stripe の集計：決済 7件（返金した請求も決済された月の売上に入る）、返金 1件
  assert.equal(report.stripe.payments, 7);
  assert.equal(report.stripe.total.grossYen, 1800 + 14800 + 12000 + 3600 + 1800 + 5000 + 10000);
  assert.equal(report.stripe.refunds, 1);
  assert.equal(report.stripe.total.refundYen, 3600);
});

test("a partly refunded payment keeps the part that was not refunded", () => {
  const report = buildMonthReport(
    source({
      payments: [
        // 12,000円のうち 6,000円だけ返金。残りの 6,000円は入金。
        { amount: 12000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:00.000Z", contract_id: null, invoice_id: "in_1", lines: [{ amount: 12000, kind: "share" }] },
        { amount: 12000, status: "refunded", kind: "subscription", occurred_at: "2026-08-10T01:00:05.000Z", contract_id: null, invoice_id: "in_1", refunded_amount: 6000 },
        // 全額返金。
        { amount: 12000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-11T01:00:00.000Z", contract_id: null, invoice_id: "in_2", lines: [{ amount: 12000, kind: "share" }] },
        { amount: 12000, status: "refunded", kind: "subscription", occurred_at: "2026-08-11T01:00:05.000Z", contract_id: null, invoice_id: "in_2", refunded_amount: 12000 },
        // 返金額が記録されていない返金は、全額返金として扱う。
        { amount: 3600, status: "succeeded", kind: "subscription", occurred_at: "2026-08-12T01:00:00.000Z", contract_id: null, invoice_id: "in_3", lines: [{ amount: 3600, kind: "dues" }] },
        { amount: 3600, status: "refunded", kind: "subscription", occurred_at: "2026-08-12T01:00:05.000Z", contract_id: null, invoice_id: "in_3" },
        // Webhook の行がなく、同期の行だけがある一部返金（Webhook 開始前の決済）。
        { amount: 1800, status: "refunded", kind: "subscription", occurred_at: "2026-08-13T01:00:00.000Z", contract_id: null, invoice_id: "in_4", refunded_amount: 800 },
      ],
    }),
    "2026-08",
  );
  assert.ok(report);
  assert.equal(report.shareIncomeYen, 6000);
  assert.equal(report.duesYen, 0);
  assert.equal(report.otherIncomeYen, 1000);
  assert.equal(report.incomeYen, 7000);
});

test("support that predates the member's registration on the site is still counted", () => {
  const data = source({
    customers: [
      // 旧サイトからの支援者。会員サイトへの登録（入会日）は9月。
      { id: "old", email: "old@x.jp", status: "active", joined_at: "2026-09-10T00:00:00.000Z", created_at: "2026-06-04T00:00:00.000Z", updated_at: "2026-09-10T00:00:00.000Z" },
      { id: "left", email: "left@x.jp", status: "withdrawn", joined_at: "2026-06-04T00:00:00.000Z", created_at: "2026-06-04T00:00:00.000Z", updated_at: "2026-07-10T00:00:00.000Z" },
    ],
    horses: [{ id: "ume", name: "梅", created_at: "2020-01-01T00:00:00.000Z" }],
    supports: [
      { customer_id: "old", horse_id: "ume", units: 1, monthly_amount: 12000, started_at: "2026-06-04T00:00:00.000Z", canceled_at: null, status: "active" },
      { customer_id: "left", horse_id: "ume", units: 0.5, monthly_amount: 6000, started_at: "2026-06-04T00:00:00.000Z", canceled_at: null, status: "active" },
    ],
  });
  const july = buildMonthReport(data, "2026-07");
  assert.ok(july);
  // 会員数には入会日からしか入らないが、支援は続いていたので数える。退会した人の支援は数えない。
  assert.equal(july.counts.total, 0);
  assert.equal(july.counts.shareSupporters, 1);
  assert.equal(july.counts.shareUnits, 1);
  assert.equal(july.counts.supportYen, 12000);
});

test("a discounted invoice is split by the share of its line items", () => {
  const report = buildMonthReport(
    source({
      payments: [
        { amount: 6900, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:00.000Z", contract_id: null, invoice_id: "in_1", lines: [{ amount: 1800, kind: "dues" }, { amount: 12000, kind: "share" }] },
        // 口数変更の日割り。未使用分の戻しと、残り期間の請求が同じ区分で相殺される。
        { amount: 5999, status: "succeeded", kind: "subscription", occurred_at: "2026-08-20T01:00:00.000Z", contract_id: null, invoice_id: "in_2", lines: [{ amount: -6000, kind: "share" }, { amount: 11999, kind: "share" }] },
      ],
    }),
    "2026-08",
  );
  assert.ok(report);
  assert.equal(report.duesYen, 900);
  assert.equal(report.shareIncomeYen, 6000 + 5999);
  assert.equal(report.incomeYen, 6900 + 5999);
});

test("Stripe receipts count each payment once and leave out payments that did not go through Stripe", () => {
  const receipts = stripeReceipts(
    source({
      payments: [
        { amount: 1800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:00.000Z", contract_id: null, invoice_id: "in_1" },
        { amount: 1800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:05.000Z", contract_id: null, invoice_id: "in_1", charge_id: "ch_1", fee: 72 },
        { amount: 10000, status: "succeeded", kind: "donation", occurred_at: "2026-08-18T01:00:00.000Z", contract_id: null, payment_intent_id: "pi_1" },
        { amount: 10000, status: "succeeded", kind: "one_time", occurred_at: "2026-08-18T01:00:04.000Z", contract_id: null, payment_intent_id: "pi_1", charge_id: "ch_2", fee: 396 },
        // 銀行振込の寄付を手で入金済みにした行。Stripe の番号が無い。
        { amount: 30000, status: "succeeded", kind: "donation", occurred_at: "2026-08-19T01:00:00.000Z", contract_id: null },
        { amount: 4000, status: "failed", kind: "one_time", occurred_at: "2026-08-19T01:00:00.000Z", contract_id: null, payment_intent_id: "pi_2", charge_id: "ch_3" },
      ],
    }),
  );
  assert.equal(receipts.length, 2);
  assert.equal(receipts.reduce((sum, receipt) => sum + receipt.amount, 0), 1800 + 10000);
  assert.equal(receipts.reduce((sum, receipt) => sum + receipt.fee, 0), 72 + 396);
  assert.deepEqual(receipts.map((receipt) => receipt.donation), [false, true]);
});

test("a refund is counted in the month it was made, as Stripe's balance report does", () => {
  const data = source({
    payments: [
      // 8月に決済、9月に半分を返金。
      { amount: 12000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:00.000Z", contract_id: null, invoice_id: "in_1", lines: [{ amount: 12000, kind: "share" }], billing_reason: "subscription_cycle", payer: "cus_1" },
      { amount: 12000, status: "refunded", kind: "subscription", occurred_at: "2026-08-10T01:00:05.000Z", contract_id: null, invoice_id: "in_1", charge_id: "ch_1", fee: 475, refunded_amount: 6000, refunds: [{ amount: 6000, at: "2026-09-15T02:00:00.000Z" }] },
      // 会費と一口支援が同じ請求に載っていて、手数料は金額の比率で分ける。
      { amount: 13800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-12T01:00:00.000Z", contract_id: null, invoice_id: "in_2", lines: [{ amount: 1800, kind: "dues" }, { amount: 12000, kind: "share" }], billing_reason: "subscription_cycle", payer: "cus_2" },
      { amount: 13800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-12T01:00:05.000Z", contract_id: null, invoice_id: "in_2", charge_id: "ch_2", fee: 547 },
    ],
  });
  const receipts = stripeReceipts(data);
  const august = stripeMonth(receipts, monthStart(2026, 8).getTime(), monthStart(2026, 9).getTime());
  assert.equal(august.payments, 2);
  assert.equal(august.total.grossYen, 25800);
  assert.equal(august.total.refundYen, 0);
  assert.equal(august.total.feeYen, 475 + 547);
  assert.equal(august.kinds.share.grossYen, 24000);
  assert.equal(august.kinds.dues.grossYen, 1800);
  assert.equal(august.kinds.dues.feeYen + august.kinds.share.feeYen, 475 + 547);
  assert.equal(august.kinds.dues.feeYen, Math.round((547 * 1800) / 13800));
  assert.equal(august.feeMissing, 0);

  const september = stripeMonth(receipts, monthStart(2026, 9).getTime(), monthStart(2026, 10).getTime());
  assert.equal(september.payments, 0);
  assert.equal(september.refunds, 1);
  assert.equal(september.kinds.share.refundYen, 6000);

  // 8月の報告は決済額のまま、9月の報告で返金を引く。
  assert.equal(buildMonthReport(data, "2026-08")?.shareIncomeYen, 24000);
  assert.equal(buildMonthReport(data, "2026-09")?.shareIncomeYen, -6000);
});

test("a finished month takes its support figures from Stripe's charges; the current month takes them from the site registration", () => {
  const data = source({
    customers: [{ id: "u1", email: "a@x.jp", status: "active", joined_at: "2026-06-04T00:00:00.000Z", created_at: "2026-06-04T00:00:00.000Z", updated_at: "2026-06-04T00:00:00.000Z" }],
    horses: [{ id: "ume", name: "梅", created_at: "2020-01-01T00:00:00.000Z" }],
    // サイトの登録は 1口だけ。Stripe では 2名が合わせて 2.5口ぶんを払っている。
    supports: [{ customer_id: "u1", horse_id: "ume", units: 1, monthly_amount: 12000, started_at: "2026-06-04T00:00:00.000Z", canceled_at: null, status: "active" }],
    payments: [
      { amount: 24000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:00.000Z", contract_id: null, invoice_id: "in_1", lines: [{ amount: 24000, kind: "share" }], billing_reason: "subscription_cycle", payer: "cus_1" },
      { amount: 6000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-11T01:00:00.000Z", contract_id: null, invoice_id: "in_2", lines: [{ amount: 6000, kind: "share" }], billing_reason: "subscription_create", payer: "cus_2" },
      // 口数変更の日割りは月額に入れない。
      { amount: 5999, status: "succeeded", kind: "subscription", occurred_at: "2026-08-20T01:00:00.000Z", contract_id: null, invoice_id: "in_3", lines: [{ amount: 5999, kind: "share" }], billing_reason: "subscription_update", payer: "cus_1" },
      { amount: 1800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-12T01:00:00.000Z", contract_id: null, invoice_id: "in_4", lines: [{ amount: 1800, kind: "dues" }], billing_reason: "subscription_cycle", payer: "cus_3" },
    ],
    linesSince: "2026-06-30T15:00:00.000Z",
    liveSupport: { ym: "2026-10", yen: 36000, supporters: 3, units: 3, pastDueYen: 12000 },
  });
  const now = new Date("2026-10-05T03:00:00.000Z");

  const august = buildMonthReport(data, "2026-08", null, { now });
  assert.equal(august?.supportBasis, "billed");
  assert.equal(august?.counts.supportYen, 30000);
  assert.equal(august?.counts.shareSupporters, 2);
  assert.equal(august?.counts.shareUnits, 2.5);
  assert.equal(august?.shareIncomeYen, 35999);
  assert.deepEqual(august?.registered, { supportYen: 12000, shareSupporters: 1, shareUnits: 1 });

  const october = buildMonthReport(data, "2026-10", null, { now });
  // 当月の支援合計額は、サイトの登録の口数 × 1口の金額（ここでは 1口 × 12,000円）。
  assert.equal(october?.supportBasis, "registered");
  assert.equal(october?.counts.supportYen, 12000);
  // 当月の支援者数・口数は、支援管理と同じくサイトの登録（ここでは 1名・1口）。Stripe の人数・口数は別に持つ。
  assert.equal(october?.counts.shareSupporters, 1);
  assert.equal(october?.counts.shareUnits, 1);
  assert.deepEqual(october?.stripeSupport, { supporters: 3, units: 3, yen: 36000, basis: "live" });
  assert.deepEqual(october?.registered, { supportYen: 12000, shareSupporters: 1, shareUnits: 1 });
  // 平均は、月額（Stripe）を払っている人数で割る。
  assert.equal(october?.averageSupportYen, 12000);
  assert.equal(october?.supportPastDueYen, 12000);
  // 終わった月は、人数・口数も Stripe が課金した定期課金。
  assert.deepEqual(august?.stripeSupport, { supporters: 2, units: 2.5, yen: 30000, basis: "billed" });
  // 推移グラフ：7月は請求の記録が無いので 0、8月は課金額、9月は課金なし、10月はサイトの登録の口数 × 12,000円
  assert.deepEqual(october?.series.map((point) => point.supportYen), [0, 30000, 0, 12000]);

  // Stripe の記録を読み込んでいないときは、サイトの登録から数える。
  const plain = buildMonthReport({ ...data, linesSince: null, liveSupport: null }, "2026-08", null, { now });
  assert.equal(plain?.supportBasis, "registered");
  assert.equal(plain?.counts.supportYen, 12000);
});

test("invoice lines are sorted into dues, team, and share by plan or product name", () => {
  assert.equal(incomeKindOfLine("1 × メンバーズ会員 (at ¥1,800 / month)"), "dues");
  assert.equal(incomeKindOfLine("1 × Retouchメンバーズ サポーター会員 (at ¥3,600 / month)"), "dues");
  assert.equal(incomeKindOfLine("1 × リェリーフ会員 (at ¥7,200 / month)"), "dues");
  assert.equal(incomeKindOfLine("1 × Retouchメンバーズ 半口支援馬会員 (at ¥6,000 / month)"), "share");
  assert.equal(incomeKindOfLine("1 × １口支援馬会員（追加） (at ¥12,000 / month)"), "share");
  assert.equal(incomeKindOfLine("23 Sep 2026以降の 2 × Retouchメンバーズ 支援（半口単位） の残り時間"), "share");
  assert.equal(incomeKindOfLine("1 × 番外編　目が負傷のポニー救済支援チーム (at ¥1,000 / month)"), "team");
  assert.equal(incomeKindOfLine("1 × Retouch Ponys Team（RPT）支援メンバー (at ¥3,000 / month)"), "team");
  assert.equal(incomeKindOfLine("1 × RetouchPony【リタポ】メンバー (at ¥3,000 / month)"), "team");
  assert.equal(incomeKindOfLine("名前を変えた料金", "SUPPORT"), "share");
  assert.equal(incomeKindOfLine("名前を変えた料金", "B"), "dues");
  assert.equal(incomeKindOfLine("見学会の参加費"), "other");
  assert.equal(incomeKindOfLine(null), "other");
});

test("manual adjustments turn the system numbers into the published numbers", () => {
  const data = source({
    donations: [
      { amount: 10000, status: "succeeded", payment_method: "card", donated_at: "2026-08-05T00:00:00.000Z", confirmed_at: null, payment_intent_id: "pi_aug" },
      { amount: 5000, status: "succeeded", payment_method: "bank_transfer", donated_at: "2026-08-06T00:00:00.000Z", confirmed_at: "2026-08-08T00:00:00.000Z" },
      { amount: 7000, status: "succeeded", payment_method: "card", donated_at: "2026-07-05T00:00:00.000Z", confirmed_at: null, payment_intent_id: "pi_jul" },
    ],
    payments: [
      { amount: 1800, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:00.000Z", contract_id: null, invoice_id: "in_1", lines: [{ amount: 1800, kind: "dues" }] },
      { amount: 12000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-11T01:00:00.000Z", contract_id: null, invoice_id: "in_2", lines: [{ amount: 12000, kind: "share" }] },
      { amount: 10000, status: "succeeded", kind: "donation", occurred_at: "2026-08-05T00:01:00.000Z", contract_id: null, payment_intent_id: "pi_aug", charge_id: "ch_aug" },
      { amount: 7000, status: "succeeded", kind: "donation", occurred_at: "2026-07-05T00:01:00.000Z", contract_id: null, payment_intent_id: "pi_jul", charge_id: "ch_jul" },
    ],
  });
  const system = buildMonthReport(data, "2026-08");
  assert.ok(system);
  assert.equal(system.incomeYen, 28800);
  assert.deepEqual(system.adjust, emptyAdjustments());

  const adjust = parseAdjustments({
    donationFeeYen: 360,
    donationExtraYen: 30000,
    duesFeeYen: 65,
    shareFeeYen: 432,
    shareExtraYen: 24000,
  });
  const july = parseAdjustments({ donationExtraYen: 3000 });
  const published = buildMonthReport(data, "2026-08", null, { adjust, adjustByMonth: new Map([["2026-07", july]]) });
  assert.ok(published);
  // 一口支援：カード決済 12,000 − 手数料 432 ＋ 銀行振込・引落 24,000
  assert.equal(published.shareIncomeYen, 35568);
  assert.equal(published.duesYen, 1735);
  // 単発寄付：手数料はカードから引き、申告のない直接振込は振込に足す
  assert.deepEqual(published.donations, { card: 9640, bank: 35000, total: 44640 });
  assert.equal(published.incomeYen, 44640 + 1735 + 35568);
  assert.equal(published.operatingYen, Math.round(published.incomeYen * 0.2));
  assert.equal(published.operatingYen + published.careYen, published.incomeYen);
  // システム計算は残る
  assert.deepEqual(published.system, system.system);
  assert.deepEqual(published.system, { donationCard: 10000, donationBank: 5000, duesYen: 1800, shareIncomeYen: 12000, incomeYen: 28800 });
  // 推移グラフの単発寄付も、各月の公開した数字に合わせる
  assert.deepEqual(published.series.map((point) => point.donationYen), [7000 + 3000, 44640]);
});

test("a card donation with no Stripe payment is not counted as card", () => {
  const report = buildMonthReport(
    source({
      donations: [
        // 決済画面は期限切れで未払い。あとから手作業で入金済みにされた寄付（銀行振込などで受け取ったもの）。
        { amount: 5000, status: "succeeded", payment_method: "card", donated_at: "2026-07-01T00:24:00.000Z", confirmed_at: null, payment_intent_id: null },
        // 6/30 23:59 に決済画面を開き、7/1 0:00 に決済された寄付。Stripe の日付（7月）で数える。
        { amount: 3000, status: "succeeded", payment_method: "card", donated_at: "2026-06-30T14:59:00.000Z", confirmed_at: null, payment_intent_id: "pi_1" },
      ],
      payments: [
        { amount: 5000, status: "succeeded", kind: "donation", occurred_at: "2026-07-01T00:24:00.000Z", contract_id: null },
        { amount: 3000, status: "succeeded", kind: "donation", occurred_at: "2026-06-30T15:00:10.000Z", contract_id: null, payment_intent_id: "pi_1", charge_id: "ch_1" },
      ],
    }),
    "2026-07",
  );
  assert.ok(report);
  assert.deepEqual(report.donations, { card: 3000, bank: 5000, total: 8000 });
  assert.equal(report.stripe.payments, 1);
});

test("sold horses are taken out of boarding", () => {
  const data = source({
    horses: [
      { id: "ume", name: "01：梅（千葉）", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "late", name: "50：（故）桜", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "sold1", name: "07：ブライト（オーナー決定）", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "sold2", name: "08：ピノ（オーナー決定）", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "new", name: "63：名前募集", created_at: "2026-09-10T00:00:00.000Z" },
    ],
  });
  const auto = buildMonthReport(data, "2026-08");
  assert.deepEqual(auto?.horseDefaults, { rescued: 3, sold: 2, added: 0 });
  assert.equal(auto?.rescuedHorses, 3);
  assert.equal(auto?.soldHorses, 2);
  assert.equal(auto?.boardingHorses, 1);
  assert.equal(auto?.boardingYen, BOARDING_PER_HORSE_YEN);

  // 売却した頭数を手で入れたとき
  const manualSold = buildMonthReport(data, "2026-08", null, { adjust: parseAdjustments({ soldHorses: 1 }) });
  assert.equal(manualSold?.boardingHorses, 2);

  // 保護した頭数を手で入れ、売却は自動のまま
  const manualRescued = buildMonthReport(data, "2026-08", 10);
  assert.equal(manualRescued?.soldHorses, 2);
  assert.equal(manualRescued?.boardingHorses, 8);

  // 売却が保護した頭数を超えることはない
  const tooMany = buildMonthReport(data, "2026-08", 1, { adjust: parseAdjustments({ soldHorses: 5 }) });
  assert.equal(tooMany?.soldHorses, 1);
  assert.equal(tooMany?.boardingHorses, 0);
});

test("adjustment input keeps fees non-negative and lets the added amount be negative", () => {
  const adjust = parseAdjustments({ shareFeeYen: -500, shareExtraYen: "-12000", donationExtraYen: "30000.4", duesFeeYen: "abc", soldHorses: "" });
  assert.equal(adjust.shareFeeYen, 0);
  assert.equal(adjust.shareExtraYen, -12000);
  assert.equal(adjust.donationExtraYen, 30000);
  assert.equal(adjust.duesFeeYen, 0);
  assert.equal(adjust.soldHorses, null);
  assert.equal(parseAdjustments({ soldHorses: "3" }).soldHorses, 3);
  assert.equal(parseAdjustments({ soldHorses: -1 }).soldHorses, null);
  assert.deepEqual(parseAdjustments(null), emptyAdjustments());
  assert.equal(hasIncomeAdjustments(emptyAdjustments()), false);
  assert.equal(hasIncomeAdjustments(parseAdjustments({ soldHorses: 2 })), false);
  assert.equal(hasIncomeAdjustments(adjust), true);
});

test("the first system month has no comparison, and charts start at the system start", () => {
  const july = buildMonthReport(source(), "2026-07");
  assert.deepEqual(july?.comparable, { previous: false, yearAgo: false });
  assert.deepEqual(july?.series.map((point) => point.ym), ["2026-07"]);

  const september = buildMonthReport(source(), "2026-09");
  assert.deepEqual(september?.comparable, { previous: true, yearAgo: false });
  assert.deepEqual(september?.series.map((point) => point.ym), ["2026-07", "2026-08", "2026-09"]);

  const nextJuly = buildMonthReport(source(), "2027-07");
  assert.deepEqual(nextJuly?.comparable, { previous: true, yearAgo: true });
  assert.equal(nextJuly?.series.length, 6);
  assert.equal(nextJuly?.series[0].ym, "2027-02");
});

/**
 * 推移の表と過去分のダウンロードの確認用。7月に2名、8月に1名、9月に1名が入会し、8月に Stripe で一口支援の課金がある。
 * サイトには、いま有効な支援が 1.5口 登録されている（決済失敗の 1口 は支援管理でも数えない）。
 */
function trendSource(): ReportSource {
  const member = (id: string, joined: string) => ({ id, email: `${id}@x.jp`, status: "active", joined_at: joined, created_at: joined, updated_at: joined });
  return source({
    customers: [
      member("u1", "2026-07-03T00:00:00.000Z"),
      member("u2", "2026-07-20T00:00:00.000Z"),
      member("u3", "2026-08-10T00:00:00.000Z"),
      member("u4", "2026-09-10T00:00:00.000Z"),
    ],
    contracts: [{ id: "c1", customer_id: "u1", started_at: "2026-07-03T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "A" }],
    supports: [
      { customer_id: "u1", horse_id: "h1", units: 1.5, monthly_amount: 18000, started_at: "2026-09-20T00:00:00.000Z", canceled_at: null, status: "active" },
      { customer_id: "u2", horse_id: "h1", units: 1, monthly_amount: 12000, started_at: "2026-09-20T00:00:00.000Z", canceled_at: null, status: "past_due" },
    ],
    payments: [
      { amount: 24000, status: "succeeded", kind: "subscription", occurred_at: "2026-08-10T01:00:00.000Z", contract_id: null, invoice_id: "in_1", lines: [{ amount: 24000, kind: "share" }], billing_reason: "subscription_cycle", payer: "cus_1" },
    ],
    linesSince: "2026-06-30T15:00:00.000Z",
    liveSupport: { ym: "2026-10", yen: 36000, supporters: 3, units: 3, pastDueYen: 0 },
  });
}

test("the trend table lists this month, last month and the month before, each with the month it is compared to", () => {
  const now = new Date("2026-10-05T03:00:00.000Z");
  const data = trendSource();

  const october = buildMonthReport(data, "2026-10", null, { now });
  assert.deepEqual(october?.trend.map((month) => month.ym), ["2026-10", "2026-09", "2026-08"]);
  assert.deepEqual(october?.trend.map((month) => month.counts?.total), [4, 4, 3]);
  assert.deepEqual(october?.trend.map((month) => month.before?.total), [4, 3, 2]);
  // 今月の列は、これまでの今月・前月の数と同じ。
  assert.deepEqual(october?.trend[0].counts, october?.counts);
  assert.deepEqual(october?.trend[0].before, october?.previous);
  // 一口支援の口数は、当月はサイトの登録（支援管理と同じ）、終わった月はその月の Stripe の課金。
  assert.deepEqual(october?.trend.map((month) => month.counts?.shareUnits), [1.5, 0, 2]);
  assert.equal(october?.trend[1].before?.shareUnits, 2);

  // 集計を始めた月より前は数えない。
  const august = buildMonthReport(data, "2026-08", null, { now });
  assert.deepEqual(august?.trend.map((month) => month.ym), ["2026-08", "2026-07", "2026-06"]);
  assert.deepEqual(august?.trend.map((month) => month.counts?.total ?? null), [3, 2, null]);
  assert.deepEqual(august?.trend.map((month) => month.before?.total ?? null), [2, null, null]);

  const july = buildMonthReport(data, "2026-07", null, { now });
  assert.deepEqual(july?.trend.map((month) => month.counts?.total ?? null), [2, null, null]);
  assert.equal(july?.trend[0].before, null);
});

test("the download of past months has one row per month with the same numbers as each month's report", () => {
  const now = new Date("2026-10-05T03:00:00.000Z");
  const data = trendSource();
  const history = buildCountHistory(data, "2026-07", "2026-10", now);
  assert.deepEqual(history.map((month) => month.ym), ["2026-10", "2026-09", "2026-08", "2026-07"]);
  for (const month of history) {
    const report = buildMonthReport(data, month.ym, null, { now });
    assert.deepEqual(month.counts, report?.counts, month.ym);
    assert.deepEqual(month.before, report?.trend[0].before, month.ym);
  }
  assert.equal(history[3].before, null);
  assert.deepEqual(buildCountHistory(data, "bad", "2026-10", now), []);

  const table = countHistoryTable(history, "2026-10");
  assert.deepEqual(table.columns.slice(0, 5), ["月", "会員数（名）", "会員数 前月比", "無料会員（名）", "無料会員 前月比"]);
  assert.equal(table.columns.length, 1 + TREND_ROWS.length * 2 + 1);
  assert.deepEqual(table.rows.map((row) => row["月"]), ["2026年10月", "2026年9月", "2026年8月", "2026年7月"]);
  assert.deepEqual(table.rows.map((row) => row["会員数（名）"]), [4, 4, 3, 2]);
  assert.deepEqual(table.rows.map((row) => row["会員数 前月比"]), ["0.0%", "+33.3%", "+50.0%", "—"]);
  assert.deepEqual(table.rows.map((row) => row["メンバーズ会員（名）"]), [1, 1, 1, 1]);
  assert.deepEqual(table.rows.map((row) => row["一口支援数（口）"]), [1.5, 0, 2, 0]);
  // 比較先が 0 のときは率を出さない。
  assert.equal(table.rows[0]["一口支援数 前月比"], "—");
  assert.equal(table.rows[1]["一口支援数 前月比"], "-100.0%");
  assert.deepEqual(table.rows.map((row) => row["備考"]), ["月の途中の数字", "", "", ""]);
});

test("this month's supporters and units are the site's active registrations, exactly as 支援管理 adds them up", () => {
  const now = new Date("2026-10-11T03:00:00.000Z");
  const person = (id: string, status = "active", email = `${id}@x.jp`) => ({ id, email, status, joined_at: "2026-06-04T00:00:00.000Z", created_at: "2026-06-04T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" });
  const row = (customer: string, units: number, status: string, canceledAt: string | null = null) => ({ customer_id: customer, horse_id: "h1", units, monthly_amount: units * 12000, started_at: "2026-06-04T00:00:00.000Z", canceled_at: canceledAt, status });
  const data = source({
    customers: [person("a"), person("b"), person("left", "withdrawn"), person("test", "active", "kindman207@gmail.com")],
    supports: [
      row("a", 1, "active"),
      row("a", 0.5, "active"),
      // 退会済みの会員の行、過去の停止日が残っている行、非表示のテスト用アカウントの行も、状態が「有効」なら支援管理は数える。
      row("left", 2, "active"),
      row("b", 1, "active", "2026-08-01T00:00:00.000Z"),
      row("test", 0.5, "active"),
      // 決済失敗・停止は数えない。
      row("b", 3, "past_due"),
      row("b", 4, "canceled", "2026-09-01T00:00:00.000Z"),
    ],
    hiddenEmails: ["kindman207@gmail.com"],
    liveSupport: { ym: "2026-10", yen: 48000, supporters: 2, units: 4, pastDueYen: 36000 },
  });
  assert.deepEqual(activeSupportNow(data), { supportYen: 60000, shareSupporters: 4, shareUnits: 5 });

  const october = buildMonthReport(data, "2026-10", null, { now });
  assert.equal(october?.counts.shareSupporters, 4);
  assert.equal(october?.counts.shareUnits, 5);
  // 支援合計額は、その口数 × 12,000円。Stripe が課金している額は別に持つ。
  assert.equal(october?.counts.supportYen, 60000);
  assert.equal(october?.supportBasis, "registered");
  assert.deepEqual(october?.registered, { supportYen: 60000, shareSupporters: 4, shareUnits: 5 });
  assert.deepEqual(october?.stripeSupport, { supporters: 2, units: 4, yen: 48000, basis: "live" });
  assert.equal(october?.supportPastDueYen, 36000);
  // 推移の表の「今月」も同じ数字。
  assert.equal(october?.trend[0].counts?.shareUnits, 5);

  // Stripe に問い合わせられないときも、人数・口数は同じ。月額はサイトの登録から出す。
  const offline = buildMonthReport({ ...data, liveSupport: null }, "2026-10", null, { now });
  assert.equal(offline?.counts.shareUnits, 5);
  assert.equal(offline?.counts.supportYen, 60000);
  assert.equal(offline?.supportBasis, "registered");
  assert.equal(offline?.stripeSupport, null);
});

test("managed horses and the support amount per horse follow the customer's formula: units x 12,000 yen / horses", () => {
  const now = new Date("2026-10-11T03:00:00.000Z");
  const horse = (id: string, name: string, supportable = true, created = "2024-01-01T00:00:00.000Z") => ({ id, name, created_at: created, is_supportable: supportable });
  const managed = Array.from({ length: 46 }, (_, index) => horse("h" + (index + 1), String(index + 1).padStart(2, "0") + "：在籍馬"));
  const data = source({
    customers: [{ id: "u1", email: "a@x.jp", status: "active", joined_at: "2026-06-04T00:00:00.000Z", created_at: "2026-06-04T00:00:00.000Z", updated_at: "2026-06-04T00:00:00.000Z" }],
    horses: [
      ...managed,
      // 管理馬に数えない行：売却、死亡、支援受付を止めている行、新規募集の枠、月末より後に登録した馬
      horse("sold", "58：親子（オーナー決定）", false),
      horse("dead", "50：（故）アース", false),
      horse("closed", "番外編　目が負傷のポニー救済支援チーム", false),
      horse("slot", "60：緊急支援募集馬", true),
      horse("later", "64：これから来る馬", true, "2026-11-05T00:00:00.000Z"),
    ],
    // 有効な支援は合わせて 227口（45頭に 5口ずつ、1頭に 2口）
    supports: managed.map((h, index) => ({ customer_id: "u1", horse_id: h.id, units: index < 45 ? 5 : 2, monthly_amount: (index < 45 ? 5 : 2) * 12000, started_at: "2026-06-04T00:00:00.000Z", canceled_at: null, status: "active" })),
    liveSupport: { ym: "2026-10", yen: 2652000, supporters: 1, units: 221, pastDueYen: 0 },
  });
  assert.equal(managedHorseCount(data.horses, new Date("2026-10-31T15:00:00.000Z").getTime()), 46);

  const october = buildMonthReport(data, "2026-10", null, { now });
  assert.equal(october?.managedHorses, 46);
  assert.equal(october?.counts.shareUnits, 227);
  // 支援合計額 ＝ 227口 × 12,000円。Stripe で課金中の 2,652,000円 ではない。
  assert.equal(october?.counts.supportYen, 2724000);
  // 1頭あたり ＝ 2,724,000 ÷ 46 ＝ 59,217.39…（銭の位まで）
  assert.equal(october?.supportPerHorseYen, 59217.39);
  assert.equal(october?.stripeSupport?.yen, 2652000);
  // 預託の頭数は管理馬と同じ 46頭。保護馬は管理馬 46頭 ＋ 売却 1頭。新規募集の枠と、馬ではない支援チームの行は数えない。
  assert.deepEqual(october?.horseDefaults, { rescued: 47, sold: 1, added: 0 });
  assert.equal(october?.boardingHorses, 46);
  assert.equal(october?.boardingYen, 46 * BOARDING_PER_HORSE_YEN);

  // 管理馬がいないときは 0（画面は「—」を出す）。
  const empty = buildMonthReport(source({ supports: data.supports }), "2026-10", null, { now });
  assert.equal(empty?.managedHorses, 0);
  assert.equal(empty?.supportPerHorseYen, 0);
});

test("a horse added during the month is counted in boarding from the following month", () => {
  const horse = (id: string, name: string, created: string, supportable = true) => ({ id, name, created_at: created, is_supportable: supportable });
  const data = source({
    horses: [
      horse("old1", "01：パヴォーネ", "2026-05-10T00:00:00.000Z"),
      horse("old2", "02：ハル", "2026-05-10T00:00:00.000Z"),
      // 10月に加わった馬：10月の預託には入れず、11月から数える。
      horse("new", "64：お名前選定中", "2026-10-05T00:00:00.000Z"),
      // 売却した馬と亡くなった馬は、馬マスタの名前から自動で外れる。
      horse("sold", "08：ピノ（オーナー決定）", "2026-05-10T00:00:00.000Z", false),
      horse("dead", "50：（故）アース", "2026-05-10T00:00:00.000Z", false),
    ],
  });

  const october = buildMonthReport(data, "2026-10", null, { now: new Date("2026-10-20T03:00:00.000Z") });
  assert.deepEqual(october?.horseDefaults, { rescued: 3, sold: 1, added: 1 });
  assert.equal(october?.boardingHorses, 2);
  assert.equal(october?.boardingYen, 2 * BOARDING_PER_HORSE_YEN);
  // 管理馬（いま支援を募集している在籍馬）には、加わった月から入る。
  assert.equal(october?.managedHorses, 3);

  const november = buildMonthReport(data, "2026-11", null, { now: new Date("2026-11-20T03:00:00.000Z") });
  assert.deepEqual(november?.horseDefaults, { rescued: 4, sold: 1, added: 0 });
  assert.equal(november?.boardingHorses, 3);

  // 月の初め（日本時間の 1日 0時）ちょうどに登録した馬は、その月に加わった馬。
  const edge = buildMonthReport(source({ horses: [horse("edge", "65：新しい馬", "2026-09-30T15:00:00.000Z")] }), "2026-10", null, { now: new Date("2026-10-20T03:00:00.000Z") });
  assert.deepEqual(edge?.horseDefaults, { rescued: 0, sold: 0, added: 1 });

  // 手入力した頭数は、これまでどおり自動の数より優先する。
  const manual = buildMonthReport(data, "2026-10", 10, { now: new Date("2026-10-20T03:00:00.000Z") });
  assert.equal(manual?.boardingHorses, 9);
});

test("hand-entered income items are added to the published income", () => {
  const adjust = parseAdjustments({ youtubeYen: "35000", transferYen: 500000.4, otherYen: -2000, shareFeeYen: 1000 });
  assert.equal(adjust.youtubeYen, 35000);
  assert.equal(adjust.transferYen, 500000);
  assert.equal(adjust.otherYen, -2000);
  assert.deepEqual(
    [emptyAdjustments().youtubeYen, emptyAdjustments().transferYen, emptyAdjustments().otherYen],
    [0, 0, 0],
  );

  const data = source({
    contracts: [{ id: "c1", customer_id: "u1", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "A" }],
    payments: [
      { amount: 3000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "c1" },
      // 会費にも一口支援にも分けられない定期入金（システム計算の「その他」）
      { amount: 5000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-11T00:00:00.000Z", contract_id: null, invoice_id: "in_x", lines: [{ amount: 5000, kind: "other" }] },
    ],
  });
  const plain = buildMonthReport(data, "2026-10");
  assert.deepEqual(plain?.extraIncome, { youtubeYen: 0, transferYen: 0, otherYen: 5000 });
  assert.equal(plain?.incomeYen, 8000);

  const report = buildMonthReport(data, "2026-10", null, { adjust: parseAdjustments({ youtubeYen: 35000, transferYen: 500000, otherYen: 2000 }) });
  // その他は、システム計算の 5,000円に手入力の 2,000円を足した額。
  assert.deepEqual(report?.extraIncome, { youtubeYen: 35000, transferYen: 500000, otherYen: 7000 });
  assert.equal(report?.otherIncomeYen, 5000);
  assert.equal(report?.duesYen, 3000);
  assert.equal(report?.incomeYen, 3000 + 35000 + 500000 + 7000);
  assert.equal(report?.operatingYen, Math.round(545000 * 0.2));
  assert.equal(report?.careYen, 545000 - Math.round(545000 * 0.2));
});
