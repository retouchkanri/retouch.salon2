// One-off FULL backfill: re-pull every Stripe charge and upsert into payments,
// populating each row's payer email + name (from the expanded Stripe Customer,
// falling back to billing details) and linking the local customer by
// stripe_customer_id or email. Mirrors src/lib/stripeSync.ts (full mode).
// Idempotent: upserts on stripe_charge_id.
import { config } from "dotenv";
config({ path: ".env.local" });
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
});
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const idOf = (v) => (!v ? null : typeof v === "string" ? v : v.id ?? null);
const mapStatus = (c) =>
  c.refunded || (c.amount_refunded ?? 0) > 0 ? "refunded" : c.status === "succeeded" ? "succeeded" : c.status === "failed" ? "failed" : "pending";

const { data: existing } = await sb.from("payments").select("stripe_charge_id, stripe_payment_intent_id").limit(100000);
const haveCharge = new Set();
// PIs on chargeless rows only (donation webhook rows). Subscription retries share
// a PI across distinct charges, so we must NOT dedup on PIs that already have a charge.
const havePINoCharge = new Set();
for (const r of existing ?? []) {
  if (r.stripe_charge_id) haveCharge.add(r.stripe_charge_id);
  else if (r.stripe_payment_intent_id) havePINoCharge.add(r.stripe_payment_intent_id);
}

const byStripeId = new Map();
const byEmail = new Map();
async function resolveCustomer(stripeId, email) {
  if (stripeId) {
    if (!byStripeId.has(stripeId)) {
      const { data } = await sb.from("customers").select("id").eq("stripe_customer_id", stripeId).maybeSingle();
      byStripeId.set(stripeId, data?.id ?? null);
    }
    if (byStripeId.get(stripeId)) return byStripeId.get(stripeId);
  }
  if (email) {
    const k = email.toLowerCase();
    if (!byEmail.has(k)) {
      const { data } = await sb.from("customers").select("id").eq("email", email).maybeSingle();
      byEmail.set(k, data?.id ?? null);
    }
    if (byEmail.get(k)) return byEmail.get(k);
  }
  return null;
}

let synced = 0, skipped = 0, withEmail = 0, matched = 0;
for await (const charge of stripe.charges.list({ limit: 100, expand: ["data.customer", "data.refunds"] })) {
  const pi = idOf(charge.payment_intent);
  if (!haveCharge.has(charge.id) && pi && havePINoCharge.has(pi)) { skipped++; continue; }
  const cust = charge.customer && typeof charge.customer === "object" && !charge.customer.deleted ? charge.customer : null;
  const email = cust?.email || charge.billing_details?.email || charge.receipt_email || null;
  const name = cust?.name || charge.billing_details?.name || null;
  const invoiceId = idOf(charge.invoice);
  const customerId = await resolveCustomer(idOf(charge.customer), email);
  const card = charge.payment_method_details?.card;
  const refundedUnix = charge.refunds?.data?.[0]?.created;
  const { error } = await sb.from("payments").upsert(
    {
      customer_id: customerId,
      kind: invoiceId ? "subscription" : "one_time",
      amount: charge.amount,
      currency: charge.currency,
      status: mapStatus(charge),
      stripe_charge_id: charge.id,
      stripe_invoice_id: invoiceId,
      stripe_payment_intent_id: pi,
      failure_reason: charge.failure_message ?? null,
      occurred_at: new Date(charge.created * 1000).toISOString(),
      raw: {
        stripe_email: email,
        stripe_name: name,
        brand: card?.brand ?? charge.payment_method_details?.type ?? null,
        last4: card?.last4 ?? null,
        description: charge.description ?? null,
        refunded_at: refundedUnix ? new Date(refundedUnix * 1000).toISOString() : null,
      },
    },
    { onConflict: "stripe_charge_id" },
  );
  if (!error) { synced++; haveCharge.add(charge.id); if (email) withEmail++; if (customerId) matched++; }
}
console.log(`synced ${synced}, skipped ${skipped}, with email ${withEmail}, matched to local customer ${matched}`);
process.exit(0);
