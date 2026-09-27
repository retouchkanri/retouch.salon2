import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { createSupabaseAdminClient } from "./supabase/admin";
import { ensureStripeCustomer } from "./stripeSupport";

/**
 * Stripe sync for 特別チーム会員 (special team) memberships.
 *
 * Model — deliberately ISOLATED from contracts / support_subscriptions so
 * special team can coexist with A/B/C and 支援会員 without interfering with
 * those queries:
 *   - One DEDICATED Stripe Subscription per customer for special team
 *     (shared across that customer's special_team_memberships rows).
 *   - One Subscription Item per membership (per horse), quantity 1, priced
 *     at the SPECIAL_TEAM plan's monthly_amount (1,000円).
 *   - The subscription carries metadata.kind = "special_team" so the webhook
 *     can route its events away from the contracts logic.
 *
 * Stripe is OPTIONAL: when not configured the helpers return
 * `{ synced: false }` and the caller keeps the DB row active.
 */

export type SpecialTeamSyncResult = {
  synced: boolean;
  reason?: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_item_id?: string | null;
  checkout_url?: string | null;
  requires_payment?: boolean;
};

type CustomerRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  stripe_customer_id: string | null;
};

async function loadSpecialTeamPlan() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("membership_plans")
    .select("id, monthly_amount, stripe_price_id, name")
    .eq("code", "SPECIAL_TEAM")
    .eq("is_active", true)
    .order("monthly_amount", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data as {
    id: string;
    name: string;
    monthly_amount: number;
    stripe_price_id: string | null;
  } | null;
}

/** Ensure the SPECIAL_TEAM plan has a Stripe price; create one if missing. */
async function ensureSpecialTeamPrice(): Promise<{
  plan_id: string;
  stripe_price_id: string;
} | null> {
  const stripe = getStripe();
  if (!stripe) return null;
  const plan = await loadSpecialTeamPlan();
  if (!plan) return null;
  if (plan.stripe_price_id) {
    return { plan_id: plan.id, stripe_price_id: plan.stripe_price_id };
  }
  const price = await stripe.prices.create({
    currency: "jpy",
    unit_amount: plan.monthly_amount,
    recurring: { interval: "month" },
    product_data: { name: `Retouchメンバーズ ${plan.name}` },
  });
  const admin = createSupabaseAdminClient();
  await admin.from("membership_plans").update({ stripe_price_id: price.id }).eq("id", plan.id);
  return { plan_id: plan.id, stripe_price_id: price.id };
}

/** Find this customer's existing dedicated special-team Stripe subscription id, if any. */
async function findExistingSpecialTeamSubscriptionId(customerId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("special_team_memberships")
    .select("stripe_subscription_id")
    .eq("customer_id", customerId)
    .not("stripe_subscription_id", "is", null)
    .in("status", ["active", "past_due", "incomplete"])
    .limit(1)
    .maybeSingle();
  return ((data as any)?.stripe_subscription_id as string | null) ?? null;
}

/**
 * Create or attach the Stripe item for a special-team membership row.
 * Safe with Stripe disabled (returns synced:false).
 */
export async function syncSpecialTeamCreate(params: {
  customer: CustomerRow;
  membership: { id: string; horse_id: string; horse_name?: string | null };
}): Promise<SpecialTeamSyncResult> {
  const stripe = getStripe();
  if (!stripe) return { synced: false, reason: "stripe_disabled" };
  const base = await ensureSpecialTeamPrice();
  if (!base) return { synced: false, reason: "price_missing" };

  const stripeCustomerId = await ensureStripeCustomer(params.customer);
  if (!stripeCustomerId) return { synced: false, reason: "customer_creation_failed" };

  const metadata: Stripe.MetadataParam = {
    special_team_id: params.membership.id,
    horse_id: params.membership.horse_id,
    horse_name: params.membership.horse_name ?? "",
  };
  const admin = createSupabaseAdminClient();
  const existingSubId = await findExistingSpecialTeamSubscriptionId(params.customer.id);

  // Existing dedicated subscription: add an item to it.
  if (existingSubId) {
    const item = await stripe.subscriptionItems.create({
      subscription: existingSubId,
      price: base.stripe_price_id,
      quantity: 1,
      metadata,
      proration_behavior: "create_prorations",
    });
    await admin
      .from("special_team_memberships")
      .update({ stripe_subscription_id: existingSubId, stripe_subscription_item_id: item.id })
      .eq("id", params.membership.id);
    return {
      synced: true,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: existingSubId,
      stripe_subscription_item_id: item.id,
    };
  }

  // No subscription yet: create a fresh dedicated special-team subscription.
  const sub = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: base.stripe_price_id, quantity: 1, metadata }],
    collection_method: "charge_automatically",
    payment_behavior: "default_incomplete",
    proration_behavior: "create_prorations",
    metadata: { kind: "special_team", customer_id: params.customer.id },
    expand: ["latest_invoice"],
  });
  const itemId = sub.items.data[0]?.id ?? null;
  const invoice = typeof sub.latest_invoice === "string" ? null : sub.latest_invoice;
  const checkoutUrl = invoice?.hosted_invoice_url ?? null;
  const statusNeedsPayment = ["incomplete", "past_due", "unpaid"].includes(sub.status);
  await admin
    .from("special_team_memberships")
    .update({ stripe_subscription_id: sub.id, stripe_subscription_item_id: itemId })
    .eq("id", params.membership.id);
  return {
    synced: true,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: sub.id,
    stripe_subscription_item_id: itemId,
    checkout_url: checkoutUrl,
    requires_payment: statusNeedsPayment || Boolean(checkoutUrl),
  };
}

/**
 * Cancel the Stripe item for a special-team membership.
 *   - If it is the last item on the dedicated subscription, the whole
 *     subscription is scheduled to cancel at period end (or immediately
 *     when `immediate` is set).
 *   - Otherwise the single item is removed.
 */
export async function syncSpecialTeamCancel(params: {
  stripe_subscription_id: string | null;
  stripe_subscription_item_id: string | null;
  immediate?: boolean;
}): Promise<SpecialTeamSyncResult & { scheduled_cancel_at?: string | null }> {
  const stripe = getStripe();
  if (!stripe) return { synced: false, reason: "stripe_disabled" };
  if (!params.stripe_subscription_item_id) return { synced: false, reason: "item_missing" };

  if (params.stripe_subscription_id) {
    const sub = await stripe.subscriptions.retrieve(params.stripe_subscription_id);
    const isLastItem = sub.items.data.length <= 1;
    if (isLastItem) {
      if (params.immediate) {
        await stripe.subscriptions.cancel(params.stripe_subscription_id, { prorate: true });
        return { synced: true, stripe_subscription_id: sub.id, scheduled_cancel_at: null };
      }
      const updated = await stripe.subscriptions.update(params.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      const scheduled = updated.current_period_end
        ? new Date(updated.current_period_end * 1000).toISOString()
        : null;
      return { synced: true, stripe_subscription_id: sub.id, scheduled_cancel_at: scheduled };
    }
  }

  await stripe.subscriptionItems.del(params.stripe_subscription_item_id, {
    proration_behavior: "create_prorations",
  });
  return { synced: true, scheduled_cancel_at: null };
}
