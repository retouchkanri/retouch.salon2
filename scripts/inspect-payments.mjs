// READ-ONLY: categorise payments to distinguish seed/demo rows from real
// Stripe-originated rows (webhook/sync) before any cleanup.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { count: total } = await sb.from("payments").select("*", { count: "exact", head: true });
console.log("total payments:", total);

async function countWhere(label, build) {
  const { count } = await build(sb.from("payments").select("*", { count: "exact", head: true }));
  console.log(`  ${label}: ${count}`);
}

console.log("\n-- Stripe-originated markers --");
await countWhere("has stripe_event_id (webhook)", (q) => q.not("stripe_event_id", "is", null));
await countWhere("has stripe_payment_intent_id", (q) => q.not("stripe_payment_intent_id", "is", null));
await countWhere("has stripe_invoice_id", (q) => q.not("stripe_invoice_id", "is", null));
await countWhere("has raw (jsonb)", (q) => q.not("raw", "is", null));

console.log("\n-- Likely SEED (no Stripe linkage at all) --");
await countWhere(
  "event_id IS NULL & PI IS NULL & invoice IS NULL",
  (q) => q.is("stripe_event_id", null).is("stripe_payment_intent_id", null).is("stripe_invoice_id", null),
);

console.log("\n-- date range --");
const { data: oldest } = await sb.from("payments").select("occurred_at").order("occurred_at", { ascending: true }).limit(1).maybeSingle();
const { data: newest } = await sb.from("payments").select("occurred_at").order("occurred_at", { ascending: false }).limit(1).maybeSingle();
console.log("  oldest:", oldest?.occurred_at, " newest:", newest?.occurred_at);

console.log("\n-- sample rows --");
const { data: sample } = await sb
  .from("payments")
  .select("id, occurred_at, kind, amount, status, stripe_event_id, stripe_payment_intent_id, stripe_invoice_id")
  .order("occurred_at", { ascending: false })
  .limit(5);
for (const r of sample ?? []) console.log("  ", JSON.stringify(r));
process.exit(0);
