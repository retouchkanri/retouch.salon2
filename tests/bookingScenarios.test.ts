import { test } from "node:test";
import assert from "node:assert/strict";
import { hasActiveSupport, seatUsage } from "../src/lib/bookings";
import { makeSupabase } from "./helpers/mockSupabase";

/**
 * These scenarios mirror the decision logic used by the booking API routes:
 *   - supporters_only requires hasActiveSupport(customer)
 *   - capacity is enforced via seatUsage(event)
 *   - in-place edits exclude the editing customer's own seats from the count
 *
 * Keeping the orchestration here means we can test the rules independently
 * of the HTTP wrapper (which depends on Supabase auth).
 */

type Event = { id: string; capacity: number; supporters_only: boolean };

async function tryReserve(
  supabase: ReturnType<typeof makeSupabase>,
  event: Event,
  customerId: string,
  partySize: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (event.supporters_only) {
    const supporter = await hasActiveSupport(supabase as any, customerId);
    if (!supporter) return { ok: false, reason: "supporters_only" };
  }
  const usage = await seatUsage(supabase as any, event);
  if (usage.used + partySize > usage.capacity) {
    return { ok: false, reason: "capacity" };
  }
  return { ok: true };
}

test("scenario: open event accepts a booking that fits", async () => {
  const supabase = makeSupabase({
    bookings: [{ event_id: "ev", customer_id: "a", party_size: 2, status: "reserved" }],
    support_subscriptions: [],
  });
  const r = await tryReserve(supabase, { id: "ev", capacity: 5, supporters_only: false }, "b", 3);
  assert.deepEqual(r, { ok: true });
});

test("scenario: open event rejects a booking that exceeds capacity", async () => {
  const supabase = makeSupabase({
    bookings: [{ event_id: "ev", customer_id: "a", party_size: 4, status: "reserved" }],
    support_subscriptions: [],
  });
  const r = await tryReserve(supabase, { id: "ev", capacity: 5, supporters_only: false }, "b", 3);
  assert.deepEqual(r, { ok: false, reason: "capacity" });
});

test("scenario: supporters-only event blocks non-supporters", async () => {
  const supabase = makeSupabase({
    bookings: [],
    support_subscriptions: [],
  });
  const r = await tryReserve(supabase, { id: "ev", capacity: 5, supporters_only: true }, "b", 1);
  assert.deepEqual(r, { ok: false, reason: "supporters_only" });
});

test("scenario: supporters-only event allows a customer with active subscription", async () => {
  const supabase = makeSupabase({
    bookings: [],
    support_subscriptions: [
      { id: "s1", customer_id: "b", status: "active" },
    ],
  });
  const r = await tryReserve(supabase, { id: "ev", capacity: 5, supporters_only: true }, "b", 2);
  assert.deepEqual(r, { ok: true });
});

test("scenario: cancellations free seats", async () => {
  const supabase = makeSupabase({
    bookings: [
      { event_id: "ev", customer_id: "a", party_size: 5, status: "canceled" },
      { event_id: "ev", customer_id: "b", party_size: 3, status: "reserved" },
    ],
    support_subscriptions: [],
  });
  const r = await tryReserve(supabase, { id: "ev", capacity: 5, supporters_only: false }, "c", 2);
  assert.deepEqual(r, { ok: true });
});

test("scenario: in-place edit excludes own seats so capacity check works", async () => {
  const supabase = makeSupabase({
    bookings: [
      { event_id: "ev", customer_id: "me", party_size: 2, status: "reserved" },
      { event_id: "ev", customer_id: "other", party_size: 3, status: "reserved" },
    ],
    support_subscriptions: [],
  });
  const usage = await seatUsage(supabase as any, { id: "ev", capacity: 5 }, "me");
  // Used (excluding my seats) is the other customer's 3 seats.
  assert.equal(usage.used, 3);
  // With 5 capacity and the other customer holding 3, I can take at most 2 seats.
  assert.equal(usage.used + 2 <= 5, true, "edit to 2 fits exactly");
  assert.equal(usage.used + 3 > 5, true, "edit to 3 would overflow capacity");
});
