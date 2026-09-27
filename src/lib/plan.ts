import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { createSupabaseAdminClient } from "./supabase/admin";
import { ensureStripeCustomer } from "./stripeSupport";
import { isBasicMemberPlanCode } from "./constraints";

/**
 * A/B/C primary-plan subscription lifecycle.
 *
 * Mirrors the per-horse support sync but for a single monthly item
 * priced at the plan's `monthly_amount`. One active basic contract
 * (A|B|C) per customer.
 */

type CustomerRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  stripe_customer_id: string | null;
};

export type PlanCustomerContract = {
  contract_id: string;
  stripe_subscription_id: string | null;
};

async function getOrCreateStripePriceForPlan(planId: string, amount: number, name: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data: plan } = await admin
    .from("membership_plans")
    .select("id, stripe_price_id")
    .eq("id", planId)
    .maybeSingle();
  if ((plan as any)?.stripe_price_id) return (plan as any).stripe_price_id as string;
  const stripe = getStripe();
  if (!stripe) return null;
  const price = await stripe.prices.create({
    currency: "jpy",
    unit_amount: amount,
    recurring: { interval: "month" },
    product_data: { name: `Retouchメンバーズ ${name}` },
  });
  await admin.from("membership_plans").update({ stripe_price_id: price.id }).eq("id", planId);
  return price.id;
}

/**
 * Create a new A/B/C subscription for the customer. If an active basic
 * contract already exists, switch its price instead. Returns the
 * resulting contract row id.
 */
export async function subscribeBasicPlan(params: {
  customer: CustomerRow;
  plan: { id: string; code: "A" | "B" | "C"; name: string; monthly_amount: number };
}): Promise<{ contractId: string; synced: boolean; reason?: string; checkoutUrl?: string | null; requiresPayment?: boolean }> {
  const admin = createSupabaseAdminClient();
  const stripe = getStripe();

  // Conflict guard: cannot coexist with SUPPORT
  const { data: activeSupports } = await admin
    .from("support_subscriptions")
    .select("id")
    .eq("customer_id", params.customer.id)
    .in("status", ["active", "past_due"])
    .limit(1);
  if ((activeSupports ?? []).length > 0) {
    throw new Error("支援会員とA/B/C会員は併用できません。先に支援を停止してください。");
  }

  // Look for an existing basic contract to switch.
  const { data: existingContracts } = await admin
    .from("contracts")
    .select("id, stripe_subscription_id, plan_id, status, membership_plans(code)")
    .eq("customer_id", params.customer.id)
    .in("status", ["active", "past_due"]);

  const existing = (existingContracts ?? []).find((c: any) =>
    isBasicMemberPlanCode(c.membership_plans?.code ?? ""),
  ) as any;

  const priceId = await getOrCreateStripePriceForPlan(params.plan.id, params.plan.monthly_amount, params.plan.name);

  // No Stripe: DB-only path
  if (!stripe || !priceId) {
    if (existing) {
      await admin
        .from("contracts")
        .update({ plan_id: params.plan.id, status: "active" })
        .eq("id", existing.id);
      return { contractId: existing.id, synced: false, reason: "stripe_disabled" };
    }
    const { data: created, error } = await admin
      .from("contracts")
      .insert({
        customer_id: params.customer.id,
        plan_id: params.plan.id,
        status: "active",
        current_period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "契約の作成に失敗しました");
    return { contractId: created.id, synced: false, reason: "stripe_disabled" };
  }

  const stripeCustomerId = await ensureStripeCustomer(params.customer);
  if (!stripeCustomerId) throw new Error("Stripe顧客の作成に失敗しました");

  // Switch existing subscription if there is one.
  if (existing?.stripe_subscription_id) {
    const sub: Stripe.Subscription = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
    const firstItem = sub.items.data[0];
    if (!firstItem) throw new Error("既存のStripeサブスクリプションが壊れています");
    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: firstItem.id, price: priceId, quantity: 1 }],
      proration_behavior: "create_prorations",
      metadata: { contract_id: existing.id, plan_code: params.plan.code },
    });
    await admin
      .from("contracts")
      .update({
        plan_id: params.plan.id,
        status:
          updated.status === "active" ? "active" :
          updated.status === "past_due" ? "past_due" :
          updated.status === "canceled" ? "canceled" :
          updated.status === "paused" ? "paused" : "incomplete",
        current_period_end: updated.current_period_end
          ? new Date(updated.current_period_end * 1000).toISOString()
          : null,
      })
      .eq("id", existing.id);
    return { contractId: existing.id, synced: true };
  }

  // Create a fresh subscription (DB row + Stripe).
  const { data: contractRow, error: cErr } = await admin
    .from("contracts")
    .insert({
      customer_id: params.customer.id,
      plan_id: params.plan.id,
      status: "incomplete",
    })
    .select("id")
    .single();
  if (cErr || !contractRow) throw new Error(cErr?.message ?? "契約の作成に失敗しました");

  const sub = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: priceId, quantity: 1 }],
    collection_method: "charge_automatically",
    payment_behavior: "default_incomplete",
    proration_behavior: "create_prorations",
    metadata: { contract_id: contractRow.id, plan_code: params.plan.code },
    expand: ["latest_invoice"],
  });

  await admin
    .from("contracts")
    .update({
      stripe_subscription_id: sub.id,
      status:
        sub.status === "active" ? "active" :
        sub.status === "past_due" ? "past_due" :
        sub.status === "canceled" ? "canceled" :
        sub.status === "paused" ? "paused" : "incomplete",
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    })
    .eq("id", contractRow.id);

  // New subscription with no saved card: surface the hosted invoice so the
  // member can complete the first payment. The subscription activates (and
  // the webhook flips status to active) once that invoice is paid.
  const invoice = typeof sub.latest_invoice === "string" ? null : sub.latest_invoice;
  const checkoutUrl = invoice?.hosted_invoice_url ?? null;
  const requiresPayment = ["incomplete", "past_due", "unpaid"].includes(sub.status);

  return { contractId: contractRow.id, synced: true, checkoutUrl, requiresPayment };
}

/**
 * Cancel all basic (A/B/C) contracts for the customer. Does not
 * affect support subscriptions or special-team items.
 */
export async function cancelBasicPlan(customerId: string): Promise<{ canceled: number; synced: boolean }> {
  const admin = createSupabaseAdminClient();
  const stripe = getStripe();
  const { data: contracts } = await admin
    .from("contracts")
    .select("id, stripe_subscription_id, status, membership_plans(code)")
    .eq("customer_id", customerId)
    .in("status", ["active", "past_due", "paused"]);

  const basics = (contracts ?? []).filter((c: any) =>
    isBasicMemberPlanCode(c.membership_plans?.code ?? ""),
  ) as any[];

  let anySynced = false;
  for (const c of basics) {
    if (stripe && c.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(c.stripe_subscription_id, { prorate: true });
        anySynced = true;
      } catch {
        // fall through; DB will still mark canceled
      }
    }
    await admin
      .from("contracts")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", c.id);
  }
  return { canceled: basics.length, synced: anySynced };
}
