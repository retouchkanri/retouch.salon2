/**
 * One-off remediation for a support-billing report (2026-08-27):
 *
 *   Member 溝口智子様 (customers.id f1d04a05-b168-4cf9-9077-a1801624193d)
 *   reported that changing her existing 1口 supports for 25:ラファ and
 *   44:ラテ to 半口 fails with a raw error ("No such subscription:
 *   sub_1U8onYI78wDNWYHlOwHu44gy" / "You cannot update a subscription that
 *   is `incomplete_expired`.").
 *
 * Root cause (confirmed via Stripe + DB inspection):
 *   Her original contract (id 4f2809e6-114c-4a4f-aaf2-22fcb013a49e, covering
 *   4 legacy horses: 23:アンジュ, 25:ラファ, 24:ヒナタ, 44:ラテ, ¥12,000
 *   each) had `stripe_subscription_id = null` until some earlier edit
 *   attempt triggered our self-heal code to create a brand-new Stripe
 *   subscription for it. That subscription creation used the customer's
 *   account-level default payment method, which is a Stripe **Link**
 *   payment method (`pm_1U6mwxI78wDNWYHllWQiVoQh`) — Link cannot be charged
 *   off-session until the customer completes one interactive confirmation.
 *   With nobody present to confirm, the subscription's first invoice sat
 *   `incomplete` and Stripe auto-expired it (`incomplete_expired`) ~23h
 *   later. Stripe's `customer.subscription.deleted` webhook for that
 *   expiry then cascaded `status: "canceled"` onto the contract and all 4
 *   support rows.
 *
 *   From that point on, every edit attempt failed hard:
 *     - 25:ラファ already had an item (si_V971a8wwwgUFgn) on the dead
 *       subscription → `subscriptionItems.update` → "cannot update ...
 *       incomplete_expired".
 *     - 44:ラテ/24:ヒナタ/23:アンジュ had no item yet → self-heal tried to
 *       add a new item onto the dead `contract.stripe_subscription_id` →
 *       "No such subscription".
 *
 *   The customer DOES have a valid, reusable "card" type payment method on
 *   file (pm_1U6n2tI78wDNWYHleb1vfIBY, Visa ...6301, exp 6/2028) — it's
 *   just not her account default (Link is). This script recreates the
 *   subscription using that card explicitly, so the first charge succeeds
 *   immediately without any interactive step.
 *
 * Companion code fix (see src/lib/stripeSupport.ts /
 * src/app/api/mypage/supports/[id]/route.ts):
 *   - New subscriptions now explicitly pick a non-Link payment method when
 *     the customer's default is Link.
 *   - Self-heal now also triggers when the LINKED item/subscription has
 *     since died (not just when the item id is missing), so this class of
 *     failure recovers automatically going forward instead of needing a
 *     manual script each time.
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

const CONTRACT_ID = "4f2809e6-114c-4a4f-aaf2-22fcb013a49e";
const STRIPE_CUSTOMER_ID = "cus_V70tAsu2QK5yfW";
const DEFAULT_PM = "pm_1U6n2tI78wDNWYHleb1vfIBY"; // real Visa card (not Link) on file
const BASE_PRICE_ID = "price_1Tf6EFI78wDNWYHlohDVBlx0"; // ¥6,000 quantum price (半口支援馬会員)
const BASE_UNIT_AMOUNT = 6000;
const DEAD_SUBSCRIPTION_ID = "sub_1U8onYI78wDNWYHlOwHu44gy";

const SUPPORTS = [
  {
    id: "2b536a6c-bf7e-4d33-bbf3-3f79f364247c",
    horse_id: "d5251fa0-7979-445a-baec-e65e443f0a54",
    horse_name: "23：アンジュ（千葉：八街）",
    monthly_amount: 12000,
  },
  {
    id: "6974817b-c49b-4c2d-bb40-9771565ff03f",
    horse_id: "88b0a715-463d-4077-ba35-737c9e33bc2b",
    horse_name: "25：ラファ（大阪）",
    monthly_amount: 12000,
  },
  {
    id: "fd051846-dd42-4dba-9d1f-420123c72500",
    horse_id: "af28fbea-2fdd-4711-b2be-6423194db2df",
    horse_name: "24：ヒナタ（千葉：山武）",
    monthly_amount: 12000,
  },
  {
    id: "ac665424-7f79-47de-9971-86a87a335462",
    horse_id: "0c31265a-d1eb-4504-86d4-7ff51345c65b",
    horse_name: "44：ラテ（千葉：山武）",
    monthly_amount: 12000,
  },
];

function qty(monthlyAmount) {
  return Math.max(1, Math.round(monthlyAmount / BASE_UNIT_AMOUNT));
}

async function main() {
  const { data: contract } = await sb
    .from("contracts")
    .select("id, stripe_subscription_id, status")
    .eq("id", CONTRACT_ID)
    .maybeSingle();
  if (!contract) throw new Error("Contract not found");
  if (contract.stripe_subscription_id && contract.stripe_subscription_id !== DEAD_SUBSCRIPTION_ID) {
    console.log("Contract already points at a different subscription, aborting:", contract.stripe_subscription_id);
    return;
  }

  // Confirm the old subscription really is dead before replacing it.
  const dead = await stripe.subscriptions.retrieve(DEAD_SUBSCRIPTION_ID);
  console.log("Old subscription status (expect incomplete_expired):", dead.status);
  if (dead.status !== "incomplete_expired" && dead.status !== "canceled") {
    throw new Error("Old subscription is not actually dead, aborting: " + dead.status);
  }

  // Verify the card we're about to use is a real reusable card, not Link.
  const pm = await stripe.paymentMethods.retrieve(DEFAULT_PM);
  if (pm.type !== "card") throw new Error("Chosen payment method is not a card: " + pm.type);
  console.log("Using payment method:", pm.type, pm.card.brand, pm.card.last4, "exp", pm.card.exp_month + "/" + pm.card.exp_year);

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

  console.log("Creating subscription with all 4 items using the real card (off-session safe)...");
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
    const pi = invoice.payment_intent && typeof invoice.payment_intent !== "string" ? invoice.payment_intent : null;
    if (pi) console.log("PaymentIntent status:", pi.status);
  }

  if (sub.status !== "active") {
    throw new Error(
      "New subscription did not activate immediately (status=" + sub.status +
      "). Not linking DB — investigate before retrying.",
    );
  }

  const { error: contractErr } = await sb
    .from("contracts")
    .update({
      stripe_subscription_id: sub.id,
      status: "active",
      canceled_at: null,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    })
    .eq("id", CONTRACT_ID);
  if (contractErr) throw new Error("Contract update failed: " + contractErr.message);

  for (const s of SUPPORTS) {
    const { error } = await sb
      .from("support_subscriptions")
      .update({ stripe_subscription_item_id: itemIds[s.id], status: "active", canceled_at: null })
      .eq("id", s.id);
    if (error) throw new Error(`Support update failed for ${s.id}: ` + error.message);
    console.log("Linked support", s.horse_name, "->", itemIds[s.id]);
  }

  console.log("DONE. New subscription:", sub.id, "status:", sub.status, "— fully active, no customer action needed.");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
