import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { createSupabaseAdminClient } from "./supabase/admin";
import { composeFullName } from "./registration";

/**
 * Pull payments from Stripe (the source of truth for money movement) into the
 * local `payments` table so the admin dashboard / CSV reflect real Stripe data.
 *
 * - `full: true`  → walk the entire charge history (backfill / reconcile).
 * - `full: false` (default) → incremental: only charges created since the most
 *   recent payment we already have (with a 1h overlap), for fast page-load sync.
 *
 * Idempotent: upserts on `stripe_charge_id`. Skips charges whose payment_intent
 * is already recorded (e.g. by the Stripe webhook) to avoid duplicate rows.
 */
export type StripeSyncResult = {
  synced: number;
  skipped: number;
  reason?: "stripe_disabled";
};

function mapStatus(charge: Stripe.Charge): "succeeded" | "failed" | "refunded" | "pending" {
  if (charge.refunded || (charge.amount_refunded ?? 0) > 0) return "refunded";
  if (charge.status === "succeeded") return "succeeded";
  if (charge.status === "failed") return "failed";
  return "pending";
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function syncStripePayments(
  opts: { full?: boolean } = {},
): Promise<StripeSyncResult> {
  const stripe = getStripe();
  if (!stripe) return { synced: 0, skipped: 0, reason: "stripe_disabled" };
  const admin = createSupabaseAdminClient();

  // Only need the single most recent occurred_at to bound the incremental
  // window below — a 1-row query, not a full scan. (Dedup itself is done
  // per-batch further down against an *exact* lookup, not this cutoff.)
  let latestOccurredMs = 0;
  if (!opts.full) {
    const { data: latest } = await admin
      .from("payments")
      .select("occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((latest as any)?.occurred_at) {
      latestOccurredMs = new Date((latest as any).occurred_at).getTime();
    }
  }

  // Expand the customer so we can read its email/name (subscription charges
  // often have empty billing_details; the Customer object is the reliable source).
  // Expand refunds too: recent API versions don't return refund details
  // inline on the charge, so `refunds.data[0].created` (the 返金日) is only
  // available when expanded.
  const params: Stripe.ChargeListParams = {
    limit: 100,
    expand: ["data.customer", "data.refunds"],
  };
  if (!opts.full && latestOccurredMs > 0) {
    // 1h overlap so we never miss a charge straddling the boundary.
    params.created = { gte: Math.floor(latestOccurredMs / 1000) - 60 * 60 };
  }

  // Resolve the local customer: first by stripe_customer_id, then (fallback)
  // by billing email — many imported customers have no stripe_customer_id but
  // do match on email (customers.email is citext, so case-insensitive).
  const byStripeId = new Map<string, string | null>();
  const byEmail = new Map<string, string | null>();
  async function resolveCustomer(
    stripeCustomerId: string | null,
    email: string | null,
  ): Promise<string | null> {
    if (stripeCustomerId) {
      if (!byStripeId.has(stripeCustomerId)) {
        const { data } = await admin
          .from("customers")
          .select("id")
          .eq("stripe_customer_id", stripeCustomerId)
          .maybeSingle();
        byStripeId.set(stripeCustomerId, (data as any)?.id ?? null);
      }
      const id = byStripeId.get(stripeCustomerId);
      if (id) return id;
    }
    if (email) {
      const key = email.toLowerCase();
      if (!byEmail.has(key)) {
        const { data } = await admin
          .from("customers")
          .select("id")
          .eq("email", email)
          .maybeSingle();
        byEmail.set(key, (data as any)?.id ?? null);
      }
      const id = byEmail.get(key);
      if (id) return id;
    }
    return null;
  }

  let synced = 0;
  let skipped = 0;

  // PIs recorded on a row that has NO charge id — i.e. a donation logged by the
  // webhook, which stores payment_intent but not charge. We skip a charge whose
  // PI matches one of these to avoid duplicating that webhook row.
  //
  // We deliberately do NOT dedup on PIs that already have a charge id: one
  // subscription PaymentIntent can produce several charges (a failed attempt and
  // its successful retry share a single PI but have distinct charge ids), and
  // each of those charges is a real transaction that must get its own row.
  //
  // IMPORTANT: this lookup must be an *exact* match against the charge/PI ids
  // in the current batch, not a "most recent N rows" heuristic — a previous
  // version limited this to the 1000 most-recently-occurred payments, which
  // could miss an older chargeless donation row (e.g. one just inserted by a
  // concurrent webhook, or simply outside that window) and insert a duplicate
  // "one_time" row for the same real Stripe payment. See: duplicate 寄付/単発
  // report for a payment on 2026-08-20.
  async function dedupKeysFor(
    batch: Stripe.Charge[],
  ): Promise<{ haveCharge: Set<string>; havePINoCharge: Set<string> }> {
    const haveCharge = new Set<string>();
    const havePINoCharge = new Set<string>();
    const chargeIds = batch.map((c) => c.id);
    const piIds = Array.from(
      new Set(batch.map((c) => idOf(c.payment_intent as any)).filter((v): v is string => !!v)),
    );
    const lookups: Promise<void>[] = [];
    for (const ids of chunk(chargeIds, 200)) {
      lookups.push(
        (async () => {
          const { data } = await admin.from("payments").select("stripe_charge_id").in("stripe_charge_id", ids);
          for (const r of (data ?? []) as any[]) {
            if (r.stripe_charge_id) haveCharge.add(r.stripe_charge_id);
          }
        })(),
      );
    }
    for (const ids of chunk(piIds, 200)) {
      lookups.push(
        (async () => {
          const { data } = await admin
            .from("payments")
            .select("stripe_payment_intent_id, stripe_charge_id")
            .in("stripe_payment_intent_id", ids);
          for (const r of (data ?? []) as any[]) {
            if (!r.stripe_charge_id && r.stripe_payment_intent_id) {
              havePINoCharge.add(r.stripe_payment_intent_id);
            }
          }
        })(),
      );
    }
    await Promise.all(lookups);
    return { haveCharge, havePINoCharge };
  }

  async function processBatch(batch: Stripe.Charge[]) {
    if (batch.length === 0) return;
    const { haveCharge, havePINoCharge } = await dedupKeysFor(batch);

    for (const charge of batch) {
      const pi = idOf(charge.payment_intent as any);
      // A row for this exact charge → refresh it. Otherwise, if the webhook
      // already logged this payment_intent as a chargeless row (donation), skip
      // to avoid a duplicate. Charges sharing a PI with an existing *charge* row
      // (subscription retries) are intentionally NOT skipped — see havePINoCharge.
      if (!haveCharge.has(charge.id) && pi && havePINoCharge.has(pi)) {
        skipped += 1;
        continue;
      }

      const invoiceId = idOf(charge.invoice as any);
      // Prefer the (expanded) Stripe Customer's email/name; fall back to the
      // charge billing details / receipt email. So the row always shows the payer.
      const cust =
        charge.customer && typeof charge.customer !== "string" && !(charge.customer as any).deleted
          ? (charge.customer as Stripe.Customer)
          : null;
      const email = (cust?.email || charge.billing_details?.email || charge.receipt_email || null) as
        | string
        | null;
      let name = (cust?.name || charge.billing_details?.name || null) as string | null;
      const customerId = await resolveCustomer(idOf(charge.customer as any), email);

      // Stripe often omits billing_details.name for subscription charges.
      // Fill in from the local customer record so the admin table shows a name.
      // full_name は2段階登録で姓名から合成する項目のため空のことがある。空なら
      // 姓+名から組み立てて、必ず氏名が入るようにする。
      if (!name && customerId) {
        const { data: cdata } = await admin
          .from("customers")
          .select("full_name, last_name, first_name")
          .eq("id", customerId)
          .maybeSingle();
        const full = ((cdata as any)?.full_name as string | null)?.trim();
        name =
          full ||
          composeFullName((cdata as any)?.last_name, (cdata as any)?.first_name) ||
          null;
      }

      // Display details to mirror the Stripe Transactions table.
      const card = (charge.payment_method_details as any)?.card;
      const refundedAtUnix = (charge.refunds as any)?.data?.[0]?.created as number | undefined;

      const { error } = await admin.from("payments").upsert(
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
            brand: card?.brand ?? (charge.payment_method_details as any)?.type ?? null,
            last4: card?.last4 ?? null,
            description: charge.description ?? null,
            refunded_at: refundedAtUnix ? new Date(refundedAtUnix * 1000).toISOString() : null,
          },
        },
        { onConflict: "stripe_charge_id" },
      );
      if (!error) {
        synced += 1;
      }
    }
  }

  // Process in page-sized batches (matching Stripe's own pagination) so the
  // exact dedup lookup above stays cheap while never missing a match
  // regardless of how large the overall payments table is.
  let batch: Stripe.Charge[] = [];
  for await (const charge of stripe.charges.list(params)) {
    batch.push(charge);
    if (batch.length >= 100) {
      await processBatch(batch);
      batch = [];
    }
  }
  await processBatch(batch);

  return { synced, skipped };
}
