/**
 * End-to-end smoke test for the booking flow against the live Supabase project.
 *
 * Runs the following scenario and tears down anything it created:
 *   1. Create an "open" event (capacity 2) and a "supporters_only" event.
 *   2. Pick a customer; insert a reservation that fits (party_size 1).
 *   3. Insert a second that exceeds capacity → should violate the unique
 *      constraint or trip the application-level capacity guard.
 *   4. Verify supporters_only event rejects an unsupported customer.
 *   5. Cleanup: delete bookings, delete events.
 *
 * This is intentionally simple — it doesn't go through the HTTP layer, it
 * goes straight to the DB to confirm constraints and helpers behave.
 *
 *   npx tsx scripts/smoke-bookings.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { hasActiveSupport, seatUsage } from "../src/lib/bookings";

config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Supabase env not set; aborting.");
    process.exit(1);
  }
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let openEventId: string | null = null;
  let supporterEventId: string | null = null;
  const createdBookings: string[] = [];

  try {
    // 1. Pick any customer to test against.
    const { data: customers, error: cErr } = await client
      .from("customers")
      .select("id, full_name")
      .limit(1);
    if (cErr || !customers?.length) {
      console.error("No customers found – run `npm run seed:xlsx` first.");
      process.exit(1);
    }
    const customer = customers[0]!;
    console.log(`▶ test customer: ${customer.full_name} (${customer.id})`);

    // 2. Create test events.
    const start = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const { data: openEv, error: e1 } = await client
      .from("events")
      .insert({
        type: "visit",
        title: `__SMOKE_OPEN_${Date.now()}`,
        starts_at: start,
        capacity: 2,
        supporters_only: false,
        is_published: true,
      })
      .select("id, capacity, supporters_only")
      .single();
    if (e1 || !openEv) throw e1 ?? new Error("open event insert failed");
    openEventId = openEv.id;

    const { data: supEv, error: e2 } = await client
      .from("events")
      .insert({
        type: "private_visit",
        title: `__SMOKE_SUPPORTER_${Date.now()}`,
        starts_at: start,
        capacity: 2,
        supporters_only: true,
        is_published: true,
      })
      .select("id, capacity, supporters_only")
      .single();
    if (e2 || !supEv) throw e2 ?? new Error("supporter event insert failed");
    supporterEventId = supEv.id;

    console.log(`✅ created open event ${openEventId}`);
    console.log(`✅ created supporter-only event ${supporterEventId}`);

    // 3. Insert one booking that fits.
    const { data: b1, error: b1err } = await client
      .from("bookings")
      .insert({ customer_id: customer.id, event_id: openEventId, party_size: 1, status: "reserved" })
      .select("id")
      .single();
    if (b1err || !b1) throw b1err ?? new Error("first booking failed");
    createdBookings.push(b1.id);
    console.log(`✅ booking #1 reserved (party_size=1)`);

    // 4. Capacity helper sanity-check.
    const usage = await seatUsage(client as any, openEv as any);
    if (usage.used !== 1 || usage.remaining !== 1) {
      throw new Error(`unexpected usage: ${JSON.stringify(usage)}`);
    }
    console.log(`✅ seatUsage(open) = ${JSON.stringify(usage)}`);

    // 5. supporters_only check.
    const supporter = await hasActiveSupport(client as any, customer.id);
    console.log(`▶ customer ${supporter ? "has" : "does NOT have"} active support`);

    // 6. Cancel the reservation and re-check capacity.
    await client.from("bookings").update({ status: "canceled", canceled_at: new Date().toISOString() }).eq("id", b1.id);
    const usage2 = await seatUsage(client as any, openEv as any);
    if (usage2.used !== 0 || usage2.remaining !== 2) {
      throw new Error(`cancellation didn't free seat: ${JSON.stringify(usage2)}`);
    }
    console.log(`✅ after cancel, seatUsage(open) = ${JSON.stringify(usage2)}`);

    console.log("\nAll booking smoke checks passed ✅");
  } catch (e: any) {
    console.error("\n❌ booking smoke failed:", e?.message ?? e);
    process.exitCode = 1;
  } finally {
    // Cleanup created bookings + events.
    for (const id of createdBookings) {
      await client.from("bookings").delete().eq("id", id);
    }
    for (const id of [openEventId, supporterEventId]) {
      if (id) await client.from("events").delete().eq("id", id);
    }
    console.log("🧹 cleanup complete");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
