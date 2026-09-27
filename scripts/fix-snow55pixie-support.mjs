/**
 * One-off remediation for a support-billing report (2026-08-27):
 *
 *   Member snow55pixie@gmail.com (山内様, 1口支援 since 2026-05) reported that
 *   after updating their card in the Stripe Billing Portal, charges still
 *   fail every month.
 *
 * Root cause (confirmed via Stripe + DB inspection):
 *   Our `customers` row for this person has `stripe_customer_id =
 *   cus_UmNqNdX8UOttyO`, and `contracts.stripe_subscription_id` /
 *   `support_subscriptions.stripe_subscription_item_id` are all NULL for
 *   their 3 active supports (33:マリア ¥12,000 / 41:ルル ¥6,000 /
 *   44:ラテ ¥6,000) — meaning these supports were NEVER actually linked to
 *   any Stripe subscription by our app.
 *
 *   Instead, the real recurring billing for these 3 horses has been running
 *   on THREE SEPARATE, unrelated Stripe Customer objects (cus_TcqGzNfULvkfUg,
 *   cus_TcW2RbNPfysVh5, cus_SvKtsZW34HYCpc) created back in Aug/Dec 2025 —
 *   almost certainly leftovers from before this member's account was
 *   recreated/migrated in May 2026. Those 3 customers' subscriptions were
 *   never linked back into our `contracts`/`support_subscriptions` tables at
 *   all, so our app has no record of them.
 *
 *   When the member updated their card via the Billing Portal, the portal
 *   session was necessarily scoped to the ONE Stripe customer our app knows
 *   about (cus_UmNqNdX8UOttyO) — which has no billable subscription on it.
 *   The 3 old orphaned customers kept retrying the member's OLD (blocked)
 *   card every few days (visible in the billing-history screenshot, card
 *   ...8927) until Stripe's Smart Retries exhausted and auto-canceled all 3
 *   subscriptions in mid-August. The member's new card was therefore never
 *   able to reach the subscriptions that were actually failing — explaining
 *   why re-adding the card "didn't fix" anything from their side.
 *
 * Fix:
 *   Re-create the 3 support items as a single fresh Stripe Subscription on
 *   the customer's CURRENT, canonical Stripe customer (cus_UmNqNdX8UOttyO),
 *   explicitly using their new default payment method, and link the
 *   resulting subscription/item ids back into `contracts` /
 *   `support_subscriptions` so future billing + self-service edits work
 *   normally. The 3 old orphaned subscriptions are already canceled by
 *   Stripe; nothing further to do there (left untouched — no back-billing
 *   for the lapsed months, that's a business decision outside this script).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const CUSTOMER_ID = "5e2cd04b-8ce0-44d4-9b33-d0b649a1a780"; // customers.id (山内様)
const CONTRACT_ID = "003f58d0-9c00-4698-acac-d4851a1bf804";
const STRIPE_CUSTOMER_ID = "cus_UmNqNdX8UOttyO";
const DEFAULT_PM = "pm_1U618dI78wDNWYHligqaL4TZ"; // the newly-added Visa via Link
const BASE_PRICE_ID = "price_1Tf6EFI78wDNWYHlohDVBlx0"; // ¥6,000 quantum price (半口支援馬会員)
const BASE_UNIT_AMOUNT = 6000;

const SUPPORTS = [
  {
    id: "f48d1c5f-3ee3-4c47-9877-c9e83015e7bb",
    horse_id: "1f14377e-97b2-4a78-abb0-f4c69a9ae7cd",
    horse_name: "33:マリア（千葉：八街）",
    monthly_amount: 12000,
  },
  {
    id: "57a650ef-73e3-4c3b-bc18-a43d58399865",
    horse_id: "ee62ccb5-1493-4846-95ce-125763afffb7",
    horse_name: "41：ルル（大阪）",
    monthly_amount: 6000,
  },
  {
    id: "b9d4a151-f0fb-4563-84f5-fc1a5411a0f7",
    horse_id: "0c31265a-d1eb-4504-86d4-7ff51345c65b",
    horse_name: "44：ラテ（千葉：山武）",
    monthly_amount: 6000,
  },
];

function qty(monthlyAmount) {
  return Math.max(1, Math.round(monthlyAmount / BASE_UNIT_AMOUNT));
}

async function main() {
  // Safety: re-verify nothing has been linked in the meantime.
  const { data: contract } = await sb
    .from("contracts")
    .select("id, stripe_subscription_id")
    .eq("id", CONTRACT_ID)
    .maybeSingle();
  if (!contract) throw new Error("Contract not found");
  if (contract.stripe_subscription_id) {
    console.log("Contract already has a Stripe subscription, aborting:", contract.stripe_subscription_id);
    return;
  }

  // Item 1 uses the shared quantum price; items 2/3 need their own ad-hoc
  // same-amount price (Stripe forbids two items on one subscription sharing
  // a price id — see resolvePriceForNewItem() in src/lib/stripeSupport.ts).
  const items = [];
  for (let i = 0; i < SUPPORTS.length; i++) {
    const s = SUPPORTS[i];
    const priceId =
      i === 0
        ? BASE_PRICE_ID
        : (
            await stripe.prices.create({
              currency: "jpy",
              unit_amount: BASE_UNIT_AMOUNT,
              recurring: { interval: "month" },
              product_data: { name: "Retouchメンバーズ 支援（半口単位）" },
            })
          ).id;
    items.push({
      price: priceId,
      quantity: qty(s.monthly_amount),
      metadata: { support_id: s.id, horse_id: s.horse_id, horse_name: s.horse_name },
    });
    console.log("Prepared item for", s.horse_name, "price:", priceId, "qty:", qty(s.monthly_amount));
  }

  console.log("Creating subscription with all 3 items...");
  const sub = await stripe.subscriptions.create({
    customer: STRIPE_CUSTOMER_ID,
    default_payment_method: DEFAULT_PM,
    items,
    collection_method: "charge_automatically",
    payment_behavior: "default_incomplete",
    proration_behavior: "create_prorations",
    metadata: { contract_id: CONTRACT_ID },
    expand: ["latest_invoice.payment_intent"],
  });
  console.log("Created subscription:", sub.id, "status:", sub.status);

  const itemIds = {};
  for (const it of sub.items.data) {
    const supportId = it.metadata?.support_id;
    if (supportId) itemIds[supportId] = it.id;
  }

  const invoice = typeof sub.latest_invoice === "string" ? null : sub.latest_invoice;
  if (invoice) {
    console.log("Latest invoice:", invoice.id, "status:", invoice.status, "amount_due:", invoice.amount_due);
    console.log("Hosted invoice URL:", invoice.hosted_invoice_url);
    const pi = invoice.payment_intent && typeof invoice.payment_intent !== "string" ? invoice.payment_intent : null;
    if (pi) console.log("PaymentIntent status:", pi.status);
  }

  // Link the DB the same way the app's own ensureContractSubscription()
  // does for a normal signup: save the linkage regardless of whether the
  // first invoice needed extra confirmation — the webhook will flip
  // status to active once the customer completes payment.
  const statusMap = {
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    incomplete: "incomplete",
    incomplete_expired: "incomplete",
  };
  const { error: contractErr } = await sb
    .from("contracts")
    .update({
      stripe_subscription_id: sub.id,
      status: statusMap[sub.status] ?? "active",
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    })
    .eq("id", CONTRACT_ID);
  if (contractErr) throw new Error("Contract update failed: " + contractErr.message);

  for (const s of SUPPORTS) {
    const { error } = await sb
      .from("support_subscriptions")
      .update({ stripe_subscription_item_id: itemIds[s.id] })
      .eq("id", s.id);
    if (error) throw new Error(`Support update failed for ${s.id}: ` + error.message);
    console.log("Linked support", s.horse_name, "->", itemIds[s.id]);
  }

  console.log("DONE. New subscription:", sub.id, "status:", sub.status);
  if (invoice?.hosted_invoice_url) {
    console.log("\n>>> Send this secure payment link to the member to complete the first charge:");
    console.log(invoice.hosted_invoice_url);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
