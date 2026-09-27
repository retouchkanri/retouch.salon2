// ONE-OFF cleanup: remove seed/demo payments so only real Stripe data remains.
// Seed rows are those with NO Stripe linkage (no event_id, payment_intent,
// invoice, or charge id). Real Stripe rows (webhook/sync) always have at least
// one of those, so they are preserved. Idempotent.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Confirmed criterion: only subscription seed rows with NO Stripe linkage.
// Donation rows (seed or manual) and all real Stripe rows are preserved.
const seedFilter = (q) =>
  q
    .eq("kind", "subscription")
    .is("stripe_event_id", null)
    .is("stripe_payment_intent_id", null)
    .is("stripe_invoice_id", null)
    .is("stripe_charge_id", null);

const { count: total } = await sb.from("payments").select("*", { count: "exact", head: true });
const { count: seed } = await seedFilter(sb.from("payments").select("*", { count: "exact", head: true }));
const kept = (total ?? 0) - (seed ?? 0);

console.log(`total payments : ${total}`);
console.log(`seed (delete)  : ${seed}`);
console.log(`Stripe (keep)  : ${kept}`);

if (!seed) {
  console.log("No seed payments to delete.");
  process.exit(0);
}

const { error, count: deleted } = await seedFilter(
  sb.from("payments").delete({ count: "exact" }),
);
if (error) {
  console.error("DELETE FAILED:", error.message);
  process.exit(1);
}
console.log(`\n✅ deleted ${deleted} seed payments.`);

const { count: after } = await sb.from("payments").select("*", { count: "exact", head: true });
console.log(`payments remaining: ${after} (all Stripe-originated)`);
process.exit(0);
