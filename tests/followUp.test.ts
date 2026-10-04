import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFollowUps, followUpRiskYen } from "../src/lib/followUp";

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
