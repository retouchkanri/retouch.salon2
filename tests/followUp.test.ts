import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARK_RETRY_DAYS,
  buildFollowUps,
  cleanFollowReasons,
  followStatus,
  followUpRiskYen,
  latestFollowMarks,
  splitFollowUps,
  type FollowMark,
  type FollowUp,
} from "../src/lib/followUp";

const now = new Date("2026-10-03T12:00:00.000Z");

test("past due and a smaller plan are flagged before withdrawal", () => {
  const rows = buildFollowUps(
    {
      customers: [
        { id: "a", name: "青木", email: "a@x.jp", status: "active", authUserId: "ua", joinedAt: "2024-01-01T00:00:00.000Z" },
        { id: "left", name: "退会者", email: "l@x.jp", status: "withdrawn", authUserId: "ul", joinedAt: "2024-01-01T00:00:00.000Z" },
      ],
      contracts: [
        { customerId: "a", status: "past_due", canceledAt: null },
        { customerId: "left", status: "canceled", canceledAt: "2026-09-01T00:00:00.000Z" },
      ],
      supports: [
        { customerId: "a", monthlyAmount: 24000, status: "canceled", startedAt: "2026-01-01T00:00:00.000Z", canceledAt: "2026-09-01T00:00:00.000Z" },
        { customerId: "a", monthlyAmount: 12000, status: "past_due", startedAt: "2026-09-01T00:00:00.000Z", canceledAt: null },
      ],
      payments: [{ customerId: "a", status: "failed", occurredAt: "2026-09-20T00:00:00.000Z", failureReason: "card expired" }],
      logins: [{ authUserId: "ua", lastSignInAt: "2026-01-01T00:00:00.000Z" }],
    },
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "青木");
  assert.ok(rows[0].reasons.includes("payment_failed"));
  assert.ok(rows[0].reasons.includes("payment_update"));
  assert.ok(rows[0].reasons.includes("usage_down"));
  assert.ok(rows[0].reasons.includes("plan_stopped"));
  assert.ok(rows[0].reasons.includes("inactive_login"));
  assert.equal(rows[0].monthlyYen, 12000);
  assert.equal(followUpRiskYen(rows).annual, 144000);
});

test("ten supporters at 3600 yen are more than 430000 yen a year", () => {
  const customers = Array.from({ length: 10 }, (_, index) => ({
    id: `c${index}`,
    name: `会員${index}`,
    email: null,
    status: "active",
    authUserId: null,
    joinedAt: "2024-01-01T00:00:00.000Z",
  }));
  const rows = buildFollowUps(
    {
      customers,
      contracts: customers.map((customer) => ({ customerId: customer.id, status: "past_due", canceledAt: null })),
      supports: customers.map((customer) => ({
        customerId: customer.id,
        monthlyAmount: 3600,
        status: "past_due",
        startedAt: "2026-01-01T00:00:00.000Z",
        canceledAt: null,
      })),
      payments: [],
      logins: [],
    },
    now,
  );
  assert.equal(rows.length, 10);
  assert.ok(followUpRiskYen(rows).annual > 430000);
});

test("a recent login and an old failed payment are not flagged", () => {
  const rows = buildFollowUps(
    {
      customers: [{ id: "b", name: "安藤", email: "b@x.jp", status: "active", authUserId: "ub", joinedAt: "2024-01-01T00:00:00.000Z" }],
      contracts: [{ customerId: "b", status: "active", canceledAt: null }],
      supports: [{ customerId: "b", monthlyAmount: 3600, status: "active", startedAt: "2026-01-01T00:00:00.000Z", canceledAt: null }],
      payments: [{ customerId: "b", status: "failed", occurredAt: "2026-01-01T00:00:00.000Z", failureReason: null }],
      logins: [{ authUserId: "ub", lastSignInAt: "2026-10-01T00:00:00.000Z" }],
    },
    now,
  );
  assert.deepEqual(rows, []);
});

function followRow(partial: Partial<FollowUp> = {}): FollowUp {
  return {
    customerId: "a",
    name: "青木",
    email: null,
    reasons: ["payment_failed"],
    monthlyYen: 12000,
    annualYen: 144000,
    detail: "",
    latestFailedAt: "2026-10-01T00:00:00.000Z",
    latestStopAt: null,
    ...partial,
  };
}

test("each row carries the time of its latest failed payment and its latest stop", () => {
  const rows = buildFollowUps(
    {
      customers: [{ id: "a", name: "青木", email: null, status: "active", authUserId: null, joinedAt: "2024-01-01T00:00:00.000Z" }],
      contracts: [{ customerId: "a", status: "canceled", canceledAt: "2026-09-10T00:00:00.000Z" }],
      supports: [
        { customerId: "a", monthlyAmount: 12000, status: "canceled", startedAt: "2026-01-01T00:00:00.000Z", canceledAt: "2026-09-25T00:00:00.000Z" },
        // 集計の期間（直近60日）より前の停止は、日時に使わない。
        { customerId: "a", monthlyAmount: 12000, status: "canceled", startedAt: "2025-01-01T00:00:00.000Z", canceledAt: "2026-06-01T00:00:00.000Z" },
      ],
      payments: [
        { customerId: "a", status: "failed", occurredAt: "2026-09-20T00:00:00.000Z", failureReason: null },
        { customerId: "a", status: "failed", occurredAt: "2026-09-28T00:00:00.000Z", failureReason: null },
      ],
      logins: [],
    },
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].latestFailedAt, "2026-09-28T00:00:00.000Z");
  assert.equal(rows[0].latestStopAt, "2026-09-25T00:00:00.000Z");
});

test("the newest record per person is the mark, and putting a row back clears it", () => {
  const marks = latestFollowMarks([
    { customerId: "a", state: "done", at: "2026-10-01T00:00:00.000Z", reasons: ["payment_failed", "bogus"] },
    { customerId: "b", state: "done", at: "2026-10-01T00:00:00.000Z", reasons: ["plan_stopped"] },
    { customerId: "b", state: "dismissed", at: "2026-10-03T00:00:00.000Z", reasons: ["plan_stopped"] },
    { customerId: "c", state: "open", at: "2026-10-05T00:00:00.000Z" },
    { customerId: "c", state: "dismissed", at: "2026-10-02T00:00:00.000Z", reasons: ["inactive_login"] },
    { customerId: null, state: "done", at: "2026-10-02T00:00:00.000Z", reasons: [] },
    { customerId: "d", state: "something-else", at: "2026-10-02T00:00:00.000Z" },
  ]);
  assert.deepEqual([...marks.keys()].sort(), ["a", "b"]);
  assert.deepEqual(marks.get("a"), { customerId: "a", state: "done", at: "2026-10-01T00:00:00.000Z", reasons: ["payment_failed"] });
  assert.equal(marks.get("b")?.state, "dismissed");
  assert.deepEqual(cleanFollowReasons("payment_failed"), []);
  assert.deepEqual(cleanFollowReasons(["usage_down", 3, "payment_failed"]), ["payment_failed", "usage_down"]);
});

test("a mark holds for the matter it was put on, and the row comes back when something new happens", () => {
  const mark: FollowMark = { customerId: "a", state: "done", at: "2026-10-02T00:00:00.000Z", reasons: ["payment_failed"] };
  const day = 24 * 60 * 60 * 1000;
  const after = (days: number) => new Date(new Date(mark.at).getTime() + days * day).toISOString();

  assert.deepEqual(followStatus(followRow(), null), { status: "open", renewed: false });
  // 印をつけたときのまま → 済。削除の印なら削除。
  assert.deepEqual(followStatus(followRow(), mark), { status: "done", renewed: false });
  assert.deepEqual(followStatus(followRow(), { ...mark, state: "dismissed" }), { status: "dismissed", renewed: false });
  // 数日おきの再請求の失敗は、同じ件。
  assert.deepEqual(followStatus(followRow({ latestFailedAt: after(5) }), mark), { status: "done", renewed: false });
  assert.deepEqual(followStatus(followRow({ latestFailedAt: after(MARK_RETRY_DAYS - 1) }), mark), { status: "done", renewed: false });
  // 30日を過ぎてからの失敗は、新しい件として未対応に戻す。
  assert.deepEqual(followStatus(followRow({ latestFailedAt: after(MARK_RETRY_DAYS) }), mark), { status: "open", renewed: true });
  // 印のあとに支援の停止があれば、すぐに戻す。印より前の停止では戻さない。
  const stopMark: FollowMark = { ...mark, reasons: ["payment_failed", "plan_stopped"] };
  assert.deepEqual(followStatus(followRow({ reasons: ["payment_failed", "plan_stopped"], latestStopAt: after(1) }), stopMark), { status: "open", renewed: true });
  assert.deepEqual(followStatus(followRow({ reasons: ["payment_failed", "plan_stopped"], latestStopAt: after(-1) }), stopMark), { status: "done", renewed: false });
  // 印をつけたときに無かった理由が加わったら、戻す。理由が減っただけでは戻さない。
  assert.deepEqual(followStatus(followRow({ reasons: ["payment_failed", "inactive_login"] }), mark), { status: "open", renewed: true });
  assert.deepEqual(followStatus(followRow({ reasons: ["payment_failed"] }), stopMark), { status: "done", renewed: false });

  const split = splitFollowUps(
    [followRow(), followRow({ customerId: "b" }), followRow({ customerId: "c" })],
    new Map([["a", mark], ["b", { ...mark, customerId: "b", state: "dismissed" as const }]]),
  );
  assert.deepEqual(
    [split.open.map((row) => row.customerId), split.done.map((row) => row.customerId), split.dismissed.map((row) => row.customerId)],
    [["c"], ["a"], ["b"]],
  );
  // 金額は、未対応の人だけで足す。
  assert.equal(followUpRiskYen(split.open).monthly, 12000);
});
