import { getStripe } from "./stripe";
import { createSupabaseAdminClient } from "./supabase/admin";

/**
 * Stripe サブスクリプションの「実状態」を contracts / support_subscriptions
 * に反映する（Webhook の取りこぼし対策・自己修復）。
 *
 * 背景:
 *   支援サブスクは `payment_behavior: default_incomplete` で作成されるため、
 *   作成直後は status=incomplete。会員が初回決済を完了すると Stripe が
 *   `customer.subscription.updated` / `invoice.payment_succeeded` を送り、
 *   Webhook が active へ昇格させる。
 *   この Webhook が（配信設定・一時障害などで）届かないと、Stripe 上は
 *   active なのに DB は incomplete のまま固着し、会員種別「—」/ 支援数0 /
 *   月額¥0 と表示されてしまう（決済支援なのに反映されない不具合）。
 *
 * この関数は contracts.stripe_subscription_id を持つ契約について Stripe の
 * 実状態を取得し、Webhook と同じ写像で DB を更新する。冪等。
 *
 *   - `onlyPending: true`（既定 false）: status が incomplete / past_due の
 *     契約だけを対象にする（ページ表示時の軽量・自己修復用）。
 *     incomplete_expired 等で取り消された分も canceled に整理される。
 */
export type ReconcileResult = {
  checked: number;
  contractsUpdated: number;
  supportsUpdated: number;
  errors: number;
  reason?: "stripe_disabled";
};

// Stripe の subscription.status → 当システムの contract/support 状態。
// Webhook（customer.subscription.updated/deleted）と同一の写像にする。
function mapContractStatus(
  stripeStatus: string,
  cancelAtPeriodEnd: boolean,
): "active" | "past_due" | "canceled" | "incomplete" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "unpaid":
      return "canceled";
    case "incomplete":
    default:
      // 「期末で停止予定」はまだ有効なので active 扱い（canceled_at で表現）。
      return cancelAtPeriodEnd ? "active" : "incomplete";
  }
}

export async function reconcileSubscriptionStatuses(
  opts: { onlyPending?: boolean } = {},
): Promise<ReconcileResult> {
  const stripe = getStripe();
  if (!stripe) return { checked: 0, contractsUpdated: 0, supportsUpdated: 0, errors: 0, reason: "stripe_disabled" };
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("contracts")
    .select("id, status, stripe_subscription_id, current_period_end, canceled_at")
    .not("stripe_subscription_id", "is", null);
  if (opts.onlyPending) query = query.in("status", ["incomplete", "past_due"]);
  const { data: contracts, error } = await query;
  if (error) throw new Error(error.message);

  let checked = 0;
  let contractsUpdated = 0;
  let supportsUpdated = 0;
  let errors = 0;

  for (const c of (contracts ?? []) as any[]) {
    checked += 1;
    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(c.stripe_subscription_id);
    } catch {
      // Stripe 側に存在しない購読（誤データ）はスキップ。誤って canceled 化しない。
      errors += 1;
      continue;
    }

    const want = mapContractStatus(sub.status, sub.cancel_at_period_end);
    const periodEndIso = sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;
    // 「期末停止予定」は active のまま canceled_at に期末日を保持。
    // 実際に canceled になったら canceled_at は now（Stripe の canceled_at 優先）。
    const canceledAtIso =
      want === "canceled"
        ? (sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : periodEndIso)
        : (sub.cancel_at_period_end ? periodEndIso : null);

    // --- contract 更新（差分があるときだけ）---
    const contractChanged =
      c.status !== want ||
      (periodEndIso && c.current_period_end !== periodEndIso) ||
      (c.canceled_at ?? null) !== (canceledAtIso ?? null);
    if (contractChanged) {
      const patch: Record<string, any> = { status: want, canceled_at: canceledAtIso };
      if (periodEndIso) patch.current_period_end = periodEndIso;
      const { error: upErr } = await admin.from("contracts").update(patch).eq("id", c.id);
      if (upErr) { errors += 1; continue; }
      contractsUpdated += 1;
    }

    // --- 紐づく support_subscriptions も同じ状態へ。
    // Webhook と同様に「進行中」の行のみ対象（手動で停止済みの行は触らない）。
    const { data: updated, error: ssErr } = await admin
      .from("support_subscriptions")
      .update({ status: want, canceled_at: canceledAtIso })
      .eq("contract_id", c.id)
      .in("status", ["active", "past_due", "incomplete"])
      .neq("status", want)
      .select("id");
    if (ssErr) { errors += 1; continue; }
    supportsUpdated += (updated as any[] | null)?.length ?? 0;
  }

  return { checked, contractsUpdated, supportsUpdated, errors };
}
