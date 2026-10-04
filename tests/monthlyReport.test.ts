import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOARDING_PER_HORSE_YEN,
  buildMonthReport,
  changeRate,
  expenseTotal,
  formatChange,
  monthStart,
  parseExpenses,
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
        { amount: 10000, status: "succeeded", payment_method: "card", donated_at: "2026-10-05T00:00:00.000Z", confirmed_at: null },
        { amount: 5000, status: "succeeded", payment_method: "bank_transfer", donated_at: "2026-09-20T00:00:00.000Z", confirmed_at: "2026-10-08T00:00:00.000Z" },
        { amount: 99999, status: "pending", payment_method: "bank_transfer", donated_at: "2026-10-02T00:00:00.000Z", confirmed_at: null },
        { amount: 8000, status: "succeeded", payment_method: "card", donated_at: "2026-09-01T00:00:00.000Z", confirmed_at: null },
      ],
      contracts: [
        { id: "c1", customer_id: "u1", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "A" },
        { id: "c2", customer_id: "u2", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "SUPPORT" },
      ],
      payments: [
        { amount: 3000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "c1" },
        { amount: 12000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "c2" },
        { amount: 4000, status: "failed", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "c1" },
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
