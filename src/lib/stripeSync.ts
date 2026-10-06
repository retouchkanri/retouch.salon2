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

/** 増分同期のたびに、何日前までの返金を確認するか。 */
const REFUND_LOOKBACK_DAYS = 45;

/** 手数料が未記録の決済を、1 回の増分同期で何件まで取り直すか。 */
const FEE_BACKFILL_PER_SYNC = 30;

/** 決済を取るときに一緒に展開する項目（支払った人、返金、残高の記録）。 */
const CHARGE_EXPAND = ["customer", "refunds", "balance_transaction"] as const;

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

/**
 * `since`（UNIX 秒）を渡すと、その時刻以降に作られた決済を取り直す（期間を区切った再同期）。
 */
export async function syncStripePayments(
  opts: { full?: boolean; since?: number } = {},
): Promise<StripeSyncResult> {
  const stripe = getStripe();
  if (!stripe) return { synced: 0, skipped: 0, reason: "stripe_disabled" };
  const admin = createSupabaseAdminClient();
  const incremental = !opts.full && opts.since == null;

  // Only need the single most recent occurred_at to bound the incremental
  // window below — a 1-row query, not a full scan. (Dedup itself is done
  // per-batch further down against an *exact* lookup, not this cutoff.)
  //
  // 基準にするのは「同期済みの決済（stripe_charge_id のある行）」の最新。Webhook の行まで含めると、
  // Webhook が新しい行を入れ続けるあいだに基準だけが先へ進み、その1時間より前の決済が同期されないまま残る
  // （2026-10：10/4 の請求5件に決済の行が無かった）。
  let latestOccurredMs = 0;
  if (incremental) {
    const { data: latest } = await admin
      .from("payments")
      .select("occurred_at")
      .not("stripe_charge_id", "is", null)
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
  // balance_transaction は Stripe の残高の記録。決済手数料（fee）と入金額（net）はここにしかない。
  const params: Stripe.ChargeListParams = {
    limit: 100,
    expand: [...CHARGE_EXPAND.map((key) => `data.${key}`)],
  };
  if (opts.since != null) {
    params.created = { gte: Math.floor(opts.since) };
  } else if (incremental && latestOccurredMs > 0) {
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
  type KnownRow = { id: string; kind: string; raw: Record<string, unknown> | null };
  async function dedupKeysFor(
    batch: Stripe.Charge[],
  ): Promise<{ haveCharge: Map<string, KnownRow>; havePINoCharge: Map<string, KnownRow> }> {
    const haveCharge = new Map<string, KnownRow>();
    const havePINoCharge = new Map<string, KnownRow>();
    const chargeIds = batch.map((c) => c.id);
    const piIds = Array.from(
      new Set(batch.map((c) => idOf(c.payment_intent as any)).filter((v): v is string => !!v)),
    );
    const lookups: Promise<void>[] = [];
    for (const ids of chunk(chargeIds, 200)) {
      lookups.push(
        (async () => {
          const { data } = await admin.from("payments").select("id, kind, raw, stripe_charge_id").in("stripe_charge_id", ids);
          for (const r of (data ?? []) as any[]) {
            if (r.stripe_charge_id) haveCharge.set(r.stripe_charge_id, { id: r.id, kind: r.kind, raw: r.raw });
          }
        })(),
      );
    }
    for (const ids of chunk(piIds, 200)) {
      lookups.push(
        (async () => {
          const { data } = await admin
            .from("payments")
            .select("id, kind, raw, stripe_payment_intent_id, stripe_charge_id")
            .in("stripe_payment_intent_id", ids);
          for (const r of (data ?? []) as any[]) {
            if (!r.stripe_charge_id && r.stripe_payment_intent_id) {
              havePINoCharge.set(r.stripe_payment_intent_id, { id: r.id, kind: r.kind, raw: r.raw });
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
      const known = haveCharge.get(charge.id) ?? null;
      // この決済の行がまだ無く、Webhook が同じ payment_intent を決済IDなしで記録済み（カードの単発寄付）なら、
      // 行を増やさず、その行に決済ID・手数料・返金を書き足す。以前はここで何もせず飛ばしていたため、
      // 寄付の決済には決済IDも手数料も返金も入らず、Stripe の一覧と 1 対 1 にならなかった。
      // Charges sharing a PI with an existing *charge* row (subscription retries)
      // are intentionally NOT treated this way — see havePINoCharge.
      const invoiceId = idOf(charge.invoice as any);
      // 書き足すのは、成功した単発の決済だけ。同じ payment_intent で先に失敗した決済は、別の行として入れる。
      const adopt =
        !known && pi && !invoiceId && charge.status === "succeeded" ? havePINoCharge.get(pi) ?? null : null;

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
      const refundList = (((charge.refunds as any)?.data ?? []) as Stripe.Refund[]).filter(
        (refund) => refund.status !== "failed" && refund.status !== "canceled",
      );
      const refundedAtUnix = refundList[0]?.created;
      const balance =
        charge.balance_transaction && typeof charge.balance_transaction !== "string" ? charge.balance_transaction : null;

      const details = {
        stripe_email: email,
        stripe_name: name,
        brand: card?.brand ?? (charge.payment_method_details as any)?.type ?? null,
        last4: card?.last4 ?? null,
        description: charge.description ?? null,
        refunded_at: refundedAtUnix ? new Date(refundedAtUnix * 1000).toISOString() : null,
        // 一部返金のとき、決済額より小さい。
        amount_refunded: charge.amount_refunded ?? 0,
        // 返金は、行われた日の月に数える（Stripe の残高レポートと同じ）。1 件の決済に複数回あることがある。
        refunds: refundList.map((refund) => ({ amount: refund.amount, at: new Date(refund.created * 1000).toISOString() })),
        // Stripe の決済手数料と、手数料を引いた入金額。失敗した決済には残高の記録が無い。
        fee: balance ? balance.fee : null,
        net: balance ? balance.net : null,
      };
      const row = {
        customer_id: customerId,
        amount: charge.amount,
        currency: charge.currency,
        status: mapStatus(charge),
        stripe_charge_id: charge.id,
        stripe_invoice_id: invoiceId,
        stripe_payment_intent_id: pi,
        failure_reason: charge.failure_message ?? null,
      };

      if (adopt) {
        // Webhook が入れた寄付の行をそのまま使う。種別（寄付）と寄付との紐付けは変えない。
        // 日時は Stripe の決済日時に合わせる（Webhook の行は決済画面を開いた時刻で、日付をまたぐことがある）。
        const { data: adopted, error } = await admin
          .from("payments")
          .update({
            ...row,
            customer_id: customerId ?? undefined,
            stripe_invoice_id: undefined,
            occurred_at: new Date(charge.created * 1000).toISOString(),
            raw: { ...(adopt.raw ?? {}), ...details },
          })
          .eq("id", adopt.id)
          .is("stripe_charge_id", null)
          .select("id");
        // この行はもう決済IDを持つ。同じ payment_intent の別の決済が来ても、ここには書かない。
        havePINoCharge.delete(pi!);
        if (!error && adopted && adopted.length === 1) {
          synced += 1;
          continue;
        }
        // 書き足せなかった（ほかの処理が先に決済IDを入れた等）ときは、下の通常の登録に回す。
      }

      const { error } = await admin.from("payments").upsert(
        {
          ...row,
          // すでにある行の種別は変えない（寄付として記録した行を「単発」に戻さない）。
          kind: known?.kind ?? (invoiceId ? "subscription" : "one_time"),
          occurred_at: new Date(charge.created * 1000).toISOString(),
          raw: { ...(known?.raw ?? {}), ...details },
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

  // 返金は、元の決済より後から起きる。上の増分取得は新しく作られた決済しか見ないので、
  // 過去の決済への返金はここで拾う。直近の返金を一覧し、その返金がまだ記録されていない決済だけを取り直す。
  if (incremental) {
    const since = Math.floor(Date.now() / 1000) - REFUND_LOOKBACK_DAYS * 24 * 60 * 60;
    const latestRefund = new Map<string, number>();
    for await (const refund of stripe.refunds.list({ limit: 100, created: { gte: since } })) {
      const chargeId = idOf(refund.charge as any);
      if (!chargeId || refund.status === "failed" || refund.status === "canceled") continue;
      latestRefund.set(chargeId, Math.max(latestRefund.get(chargeId) ?? 0, refund.created));
    }
    const recorded = new Map<string, number>();
    for (const ids of chunk([...latestRefund.keys()], 200)) {
      const { data } = await admin
        .from("payments")
        .select("stripe_charge_id, status, refunded_at:raw->>refunded_at, refunds:raw->refunds")
        .in("stripe_charge_id", ids);
      for (const row of (data ?? []) as any[]) {
        // 返金の明細（refunds）まで入っている行だけを「記録済み」とみなす。
        if (row.status !== "refunded" || !Array.isArray(row.refunds) || !row.refunded_at) continue;
        recorded.set(row.stripe_charge_id, Math.floor(new Date(row.refunded_at).getTime() / 1000));
      }
    }
    const staleIds = new Set<string>();
    for (const [chargeId, refundedAt] of latestRefund) {
      if ((recorded.get(chargeId) ?? 0) < refundedAt) staleIds.add(chargeId);
    }

    // 手数料がまだ入っていない決済（手数料を保存する前の版の同期が入れた行）も、ここで少しずつ取り直す。
    // 1 回の同期で取り直す件数を絞り、画面を開くたびに残りが減っていくようにする。
    const { data: noFee } = await admin
      .from("payments")
      .select("stripe_charge_id")
      .not("stripe_charge_id", "is", null)
      .in("status", ["succeeded", "refunded"])
      .is("raw->>fee", null)
      .gte("occurred_at", new Date((since - 15 * 24 * 60 * 60) * 1000).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(FEE_BACKFILL_PER_SYNC);
    for (const row of (noFee ?? []) as any[]) staleIds.add(row.stripe_charge_id);

    const stale: Stripe.Charge[] = [];
    for (const ids of chunk([...staleIds], 10)) {
      const fetched = await Promise.all(
        ids.map((id) => stripe.charges.retrieve(id, { expand: [...CHARGE_EXPAND] }).catch(() => null)),
      );
      for (const charge of fetched) if (charge) stale.push(charge);
    }
    await processBatch(stale);
  }

  return { synced, skipped };
}
