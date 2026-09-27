import { test } from "node:test";
import assert from "node:assert/strict";
import { hasActiveSupport, seatUsage, seatUsageBatch } from "../src/lib/bookings";
import { makeSupabase } from "./helpers/mockSupabase";

const event = { id: "ev1", capacity: 10 };

test("seatUsage: counts only non-canceled bookings", async () => {
  const supabase = makeSupabase({
    bookings: [
      { id: "b1", event_id: "ev1", customer_id: "c1", party_size: 2, status: "reserved" },
      { id: "b2", event_id: "ev1", customer_id: "c2", party_size: 3, status: "reserved" },
      { id: "b3", event_id: "ev1", customer_id: "c3", party_size: 5, status: "canceled" },
      { id: "b4", event_id: "ev1", customer_id: "c4", party_size: 1, status: "attended" },
    ],
  });
  const usage = await seatUsage(supabase as any, event);
  assert.equal(usage.capacity, 10);
  assert.equal(usage.used, 6, "2 + 3 + 1 (canceled excluded)");
  assert.equal(usage.remaining, 4);
});

test("seatUsage: excludes a specific customer (used during in-place edits)", async () => {
  const supabase = makeSupabase({
    bookings: [
      { id: "b1", event_id: "ev1", customer_id: "me", party_size: 2, status: "reserved" },
      { id: "b2", event_id: "ev1", customer_id: "other", party_size: 3, status: "reserved" },
    ],
  });
  const usage = await seatUsage(supabase as any, event, "me");
  assert.equal(usage.used, 3);
  assert.equal(usage.remaining, 7);
});

test("seatUsage: remaining never goes negative", async () => {
  const supabase = makeSupabase({
    bookings: [
      { id: "b1", event_id: "ev1", customer_id: "c1", party_size: 20, status: "reserved" },
    ],
  });
  const usage = await seatUsage(supabase as any, event);
  assert.equal(usage.used, 20);
  assert.equal(usage.remaining, 0);
});

test("seatUsageBatch: returns empty map for empty event list without DB hit", async () => {
  const supabase = makeSupabase({});
  const map = await seatUsageBatch(supabase as any, []);
  assert.equal(map.size, 0);
});

test("seatUsageBatch: aggregates per event", async () => {
  const supabase = makeSupabase({
    bookings: [
      { id: "b1", event_id: "evA", party_size: 2, status: "reserved" },
      { id: "b2", event_id: "evA", party_size: 3, status: "attended" },
      { id: "b3", event_id: "evA", party_size: 9, status: "canceled" },
      { id: "b4", event_id: "evB", party_size: 1, status: "reserved" },
    ],
  });
  const map = await seatUsageBatch(supabase as any, ["evA", "evB", "evC"]);
  assert.equal(map.get("evA"), 5);
  assert.equal(map.get("evB"), 1);
  assert.equal(map.get("evC"), undefined);
});

test("hasActiveSupport: true when at least one active subscription", async () => {
  const supabase = makeSupabase({
    support_subscriptions: [
      { id: "s1", customer_id: "cust", status: "active" },
      { id: "s2", customer_id: "cust", status: "canceled" },
    ],
  });
  assert.equal(await hasActiveSupport(supabase as any, "cust"), true);
});

test("hasActiveSupport: false when no active subscription", async () => {
  const supabase = makeSupabase({
    support_subscriptions: [
      { id: "s1", customer_id: "cust", status: "canceled" },
    ],
  });
  assert.equal(await hasActiveSupport(supabase as any, "cust"), false);
});

test("hasActiveSupport: false for unknown customer", async () => {
  const supabase = makeSupabase({ support_subscriptions: [] });
  assert.equal(await hasActiveSupport(supabase as any, "nobody"), false);
});
