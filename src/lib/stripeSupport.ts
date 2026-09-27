import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { createSupabaseAdminClient } from "./supabase/admin";
import { SUPPORT_STRIPE_QUANTUM } from "./constraints";

/**
 * Stripe sync for per-horse support subscriptions.
 *
 * Model:
 *   - One Stripe Subscription per contract (contracts.stripe_subscription_id).
 *   - One Stripe Subscription Item per support_subscription
 *     (support_subscriptions.stripe_subscription_item_id).
 *   - Quantity on each item is derived from the support row's
 *     `monthly_amount` divided by the HALF-口 quantum (¥6,000) so that
 *     half/full/multi-unit support all map to the same price id with
 *     different quantities. See SUPPORT_STRIPE_QUANTUM in constraints.ts
 *     for why the quantum is the half-口 amount and not the full ¥12,000.
 *
 * 1頭＝1サブスクリプション（2026-09〜。旧サイトと同じ請求の形）:
 *   - 馬ごとに専用の支援契約と Stripe サブスクリプションを作る
 *     （ensureDedicatedContract）。申込時に月額（半口 ¥6,000 / 1口 ¥12,000）を
 *     満額請求し、以後は申込日を更新日として毎月同額を請求する。
 *     既存のサブスクリプションに2頭目以降を「追加」しないので、日割りの端数は
 *     発生せず、1頭ずつ「次回更新日で停止」できる。
 *   - 口数の変更は次回の請求日から新しい月額を適用する（proration なし）。
 *     月の途中で差額を日割りで請求・相殺しないため、請求額は常に月額どおり。
 *   - 以前の方式でまとめて請求されている契約（1つのサブスクリプションに
 *     複数の馬）はそのまま動作する（停止・口数変更も従来どおり処理できる）。
 *
 * Stripe is OPTIONAL: when Stripe or the base price id is not configured,
 * helpers degrade to a no-op while returning `{ synced: false }` so the
 * DB side of the operation still succeeds for local/dev environments.
 */

export type SupportSyncResult = {
  synced: boolean;
  reason?: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_item_id?: string | null;
  checkout_url?: string | null;
  requires_payment?: boolean;
  /** 支援行を請求している契約（専用契約へ移した場合は新しい契約の id） */
  contract_id?: string | null;
  /**
   * 口数の変更が請求に反映される日（ISO）。変更は次回の請求日から適用し、
   * 日割りの請求・相殺はしない。新しくサブスクリプションを作った場合は null
   * （申込時に満額を請求済み）。
   */
  effective_from?: string | null;
};

/**
 * What actually happened on the Stripe side of a cancel.
 *
 *   - "scheduled"    : still billable until `scheduled_cancel_at`; the DB row
 *                      must stay `active` with `canceled_at` = that date.
 *   - "immediate"    : the item (or the whole subscription) is gone NOW; the
 *                      DB row must become `canceled` and drop its item id.
 *   - "already_gone" : nothing live was found — same DB handling as immediate.
 *   - "noop"         : Stripe disabled / row was never Stripe-billed.
 *
 * Callers MUST branch on this instead of inspecting `scheduled_cancel_at`.
 * The previous code did `sync.scheduled_cancel_at ?? contract.current_period_end`,
 * which silently turned an IMMEDIATE item deletion into a "stops at period end"
 * result: the DB row stayed `active` and kept pointing at an item Stripe had
 * already deleted. That stale-but-active row is what made a later re-signup take
 * the "add 口数 to the existing row" branch and double the member's quantity
 * (reported 2026-09).
 */
export type SupportCancelMode = "scheduled" | "immediate" | "already_gone" | "noop";

export type SupportCancelResult = SupportSyncResult & {
  mode: SupportCancelMode;
  scheduled_cancel_at?: string | null;
};

/**
 * Stripe quantity for a support row. `monthly_amount` is always a multiple of
 * the half-口 quantum, so this is exact: 半口 → 1, 1口 → 2, 1.5口 → 3, …
 */
export function supportQuantityFor(monthlyAmount: number): number {
  return Math.max(1, Math.round(monthlyAmount / SUPPORT_STRIPE_QUANTUM));
}

type CustomerRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  stripe_customer_id: string | null;
};

type ContractRow = {
  id: string;
  stripe_subscription_id: string | null;
  status: string;
};

/**
 * Ensure there is a Stripe price whose `unit_amount` equals the half-口
 * quantum (¥6,000). Support items are billed as `quantity × this price`,
 * so the quantum MUST be the half-口 amount for 半口 to charge correctly.
 *
 * Resolution order (zero-config, no manual Stripe dashboard steps):
 *   1. Reuse a SUPPORT plan that already carries a stripe_price_id created
 *      at the quantum amount (e.g. the 半口支援 plan, ¥6,000).
 *   2. Otherwise create a ¥6,000 recurring price and persist it onto a
 *      SUPPORT plan whose unit_amount matches the quantum, if one exists.
 */
async function ensureSupportBasePrice(): Promise<{
  unit_amount: number;
  stripe_price_id: string;
} | null> {
  const stripe = getStripe();
  if (!stripe) return null;
  const quantum = SUPPORT_STRIPE_QUANTUM;
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("membership_plans")
    .select("id, stripe_price_id")
    .eq("code", "SUPPORT")
    .eq("unit_amount", quantum)
    .not("stripe_price_id", "is", null)
    .limit(1)
    .maybeSingle();
  if ((existing as any)?.stripe_price_id) {
    // Verify the actual Stripe price amount matches the quantum.
    // A stale DB record pointing to a ¥12,000 price (created before the
    // quantum was halved) would otherwise charge 半口 supporters ¥12,000.
    try {
      const sp = await stripe.prices.retrieve((existing as any).stripe_price_id);
      if (sp.unit_amount === quantum) {
        return { unit_amount: quantum, stripe_price_id: sp.id };
      }
      // Amount mismatch — fall through to create a correctly-priced price.
    } catch {
      // Price deleted from Stripe — fall through to create a fresh one.
    }
  }

  const price = await stripe.prices.create({
    currency: "jpy",
    unit_amount: quantum,
    recurring: { interval: "month" },
    product_data: { name: "Retouchメンバーズ 支援（半口単位）" },
  });
  const { data: target } = await admin
    .from("membership_plans")
    .select("id")
    .eq("code", "SUPPORT")
    .eq("unit_amount", quantum)
    .limit(1)
    .maybeSingle();
  if ((target as any)?.id) {
    await admin
      .from("membership_plans")
      .update({ stripe_price_id: price.id })
      .eq("id", (target as any).id);
  }
  return { unit_amount: quantum, stripe_price_id: price.id };
}

/**
 * Stripe Link payment methods (`type: "link"`) cannot be charged off-session
 * until the customer has completed one on-session confirmation — Stripe
 * rejects `off_session: true` confirmation with "The customer needs to be
 * on-session ... setup_future_usage is also set". Since every new
 * subscription we create here bills automatically with no user present,
 * defaulting to a customer whose `invoice_settings.default_payment_method`
 * is a Link method leaves the subscription stuck `incomplete` and it
 * auto-expires ~23h later with nobody able to fix it (reported 2026-08:
 * a legacy contract's subscription silently died this way, permanently
 * breaking every future edit to the 4 horses under it with raw Stripe
 * errors like "No such subscription" / "cannot update ... incomplete_expired").
 *
 * If the customer's default is a Link method but they also have a regular
 * reusable card on file (common — Link is often just the LAST method they
 * happened to save), prefer that card explicitly so the first charge can
 * succeed immediately without requiring any interactive step.
 */
async function resolveOffSessionPaymentMethod(
  stripe: Stripe,
  stripeCustomerId: string,
): Promise<string | undefined> {
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if ((customer as any).deleted) return undefined;
    const defaultPmId = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
    if (!defaultPmId) return undefined;
    const defaultPmIdStr = typeof defaultPmId === "string" ? defaultPmId : defaultPmId.id;
    const defaultPm = await stripe.paymentMethods.retrieve(defaultPmIdStr);
    if (defaultPm.type !== "link") return undefined; // already off-session-safe

    const cards = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card" });
    return cards.data[0]?.id;
  } catch {
    return undefined; // best-effort; fall back to the account default
  }
}

/**
 * A contract's `stripe_subscription_id` can point to a subscription that
 * has since died — canceled, or auto-expired from `incomplete` after the
 * customer never completed an initial 3DS/Link confirmation — without our
 * DB ever finding out (reported 2026-08). Treat those the same as "no
 * subscription yet" so callers can self-heal by creating a fresh one
 * instead of crashing on a raw Stripe error.
 */
async function isSubscriptionLive(stripe: Stripe, subscriptionId: string): Promise<boolean> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    return sub.status !== "canceled" && sub.status !== "incomplete_expired";
  } catch (e: any) {
    if (e?.code === "resource_missing") return false;
    throw e;
  }
}

/**
 * Retrieve a subscription item only if it is STILL BILLABLE — the item itself
 * exists AND the subscription it hangs off is alive.
 *
 * Every caller that used to blindly `subscriptionItems.update(...)` on the id
 * stored in `support_subscriptions.stripe_subscription_item_id` could be acting
 * on an id that Stripe deleted long ago (staff removed the item in the Stripe
 * dashboard, a "stop" deleted it, the subscription expired). Checking first
 * turns "throws a raw Stripe error" / "silently updates nothing" into a clean
 * `null` the caller can self-heal from.
 */
async function getLiveSubscriptionItem(
  stripe: Stripe,
  itemId: string,
): Promise<Stripe.SubscriptionItem | null> {
  return (await getLiveItemAndSubscription(stripe, itemId))?.item ?? null;
}

/** getLiveSubscriptionItem と同じ判定で、アイテムと親のサブスクリプションを返す。 */
async function getLiveItemAndSubscription(
  stripe: Stripe,
  itemId: string,
): Promise<{ item: Stripe.SubscriptionItem; subscription: Stripe.Subscription } | null> {
  let item: Stripe.SubscriptionItem;
  try {
    item = await stripe.subscriptionItems.retrieve(itemId);
  } catch (e: any) {
    if (e?.code === "resource_missing") return null;
    throw e;
  }
  const subId =
    typeof item.subscription === "string" ? item.subscription : (item.subscription as any)?.id;
  if (!subId) return null;
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subId);
  } catch (e: any) {
    if (e?.code === "resource_missing") return null;
    throw e;
  }
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") return null;
  return { item, subscription };
}

function periodEndIso(sub: Stripe.Subscription): string | null {
  return sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
}

/**
 * 初回決済が済んでいない（incomplete）サブスクリプションの、未払いの請求書の
 * 支払いページ。口数を変えても、その請求書は申込時の金額のまま支払ってもらう。
 */
async function pendingFirstInvoiceUrl(stripe: Stripe, sub: Stripe.Subscription): Promise<string | null> {
  if (sub.status !== "incomplete" || !sub.latest_invoice) return null;
  try {
    const invoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice.id;
    const inv = await stripe.invoices.retrieve(invoiceId);
    return inv.status === "open" && (inv.amount_remaining ?? 0) > 0 ? inv.hosted_invoice_url ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Public probe: is this support row still attached to a billable Stripe item?
 *
 * Deliberately TRI-state. Callers decide between "add 口数 to the existing
 * support" and "replace it" based on this answer, and both wrong answers cost
 * the member money — guessing "dead" on a transient API error would silently
 * wipe out units they are paying for, guessing "live" would double their bill.
 * `"unknown"` means Stripe could not be reached and the caller must abort
 * rather than pick.
 */
export async function probeSupportItem(
  itemId: string | null | undefined,
): Promise<"live" | "dead" | "unknown"> {
  const stripe = getStripe();
  if (!stripe) return "unknown";
  if (!itemId) return "dead";
  try {
    return (await getLiveSubscriptionItem(stripe, itemId)) ? "live" : "dead";
  } catch {
    return "unknown";
  }
}

/**
 * Undo a pending "stops at period end" on a subscription. Called when a member
 * re-subscribes to a horse whose row was scheduled to stop — otherwise we would
 * happily take their money for the new units and then cancel the subscription
 * out from under them on the old schedule.
 */
async function clearScheduledCancel(stripe: Stripe, subscriptionId: string): Promise<void> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.cancel_at_period_end) {
      await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
    }
  } catch {
    // best-effort; a dead subscription is healed elsewhere
  }
}

/**
 * Resolve (or create) the Stripe customer for a member.
 *
 * The lookup by email matters more than it looks. Members who joined before
 * this system existed — or who were re-registered by staff — already have a
 * Stripe customer holding their card and their running subscriptions. Creating
 * a *second* Stripe customer for them means the site bills a second card in
 * parallel with the legacy one, and the admin UI, which only ever follows
 * `customers.stripe_customer_id`, cannot see the other half of the charges.
 * That is precisely how a member ended up paying for the same horses twice —
 * once on a Mastercard the system never knew about and once on the VISA it
 * had just registered (reported 2026-09).
 *
 * When several Stripe customers share the email we do NOT guess: guessing
 * wrong bills a stranger's card. We create a fresh one and write an audit
 * warning so staff can merge them in the Stripe dashboard. Run
 * `scripts/audit-support-billing.mjs` to list every member in that state.
 */
async function findStripeCustomerByEmail(
  stripe: Stripe,
  email: string,
): Promise<{ id: string | null; ambiguous: boolean; matches: number }> {
  let list: Stripe.Customer[];
  try {
    const res = await stripe.customers.list({ email, limit: 100 });
    list = res.data.filter((c) => !(c as any).deleted);
  } catch {
    return { id: null, ambiguous: false, matches: 0 };
  }
  if (list.length === 0) return { id: null, ambiguous: false, matches: 0 };
  if (list.length === 1) return { id: list[0].id, ambiguous: false, matches: 1 };

  // Several records: only accept one if exactly one of them is actually in use.
  const withLiveSub: string[] = [];
  for (const c of list) {
    try {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 100 });
      if (subs.data.some((s) => s.status !== "canceled" && s.status !== "incomplete_expired")) {
        withLiveSub.push(c.id);
      }
    } catch {
      // ignore this candidate
    }
  }
  if (withLiveSub.length === 1) return { id: withLiveSub[0], ambiguous: false, matches: list.length };
  return { id: null, ambiguous: true, matches: list.length };
}

export async function ensureStripeCustomer(customer: CustomerRow): Promise<string | null> {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;
  const stripe = getStripe();
  if (!stripe) return null;
  const admin = createSupabaseAdminClient();

  if (customer.email) {
    const found = await findStripeCustomerByEmail(stripe, customer.email);
    if (found.id) {
      await admin
        .from("customers")
        .update({ stripe_customer_id: found.id })
        .eq("id", customer.id);
      await admin.from("audit_logs").insert({
        action: "stripe.customer.linked",
        target_table: "customers",
        target_id: customer.id,
        meta: { stripe_customer_id: found.id, matched_by: "email", matches: found.matches },
      });
      return found.id;
    }
    if (found.ambiguous) {
      await admin.from("audit_logs").insert({
        action: "stripe.customer.ambiguous",
        target_table: "customers",
        target_id: customer.id,
        meta: {
          email: customer.email,
          matches: found.matches,
          note: "同じメールのStripe顧客が複数あり自動紐付けできません。Stripe側で統合してください（二重請求の原因になります）。",
        },
      });
    }
  }

  const created = await stripe.customers.create({
    email: customer.email ?? undefined,
    name: customer.full_name ?? undefined,
    metadata: { customer_id: customer.id },
  });
  await admin
    .from("customers")
    .update({ stripe_customer_id: created.id })
    .eq("id", customer.id);
  return created.id;
}

/**
 * Ensure the contract has an associated Stripe subscription. If the
 * subscription does not yet exist, a new one is created with a single
 * initial item for this support row.
 */
async function ensureContractSubscription(
  contract: ContractRow,
  stripeCustomerId: string,
  basePriceId: string,
  initialQuantity: number,
  metadata: Stripe.MetadataParam,
  description?: string,
): Promise<{
  subscriptionId: string;
  initialItemId: string | null;
  checkoutUrl: string | null;
  requiresPayment: boolean;
}> {
  const stripe = getStripe();
  if (!stripe) throw new Error("stripe not configured");
  if (contract.stripe_subscription_id) {
    return {
      subscriptionId: contract.stripe_subscription_id,
      initialItemId: null,
      checkoutUrl: null,
      requiresPayment: false,
    };
  }
  const defaultPaymentMethod = await resolveOffSessionPaymentMethod(stripe, stripeCustomerId);
  let sub = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
    items: [{ price: basePriceId, quantity: initialQuantity, metadata }],
    collection_method: "charge_automatically",
    payment_behavior: "default_incomplete",
    proration_behavior: "create_prorations",
    // Stripe の管理画面で、どの馬のサブスクリプションか分かるようにする
    ...(description ? { description: description.slice(0, 500) } : {}),
    metadata: {
      contract_id: contract.id,
      ...(metadata.support_id ? { support_id: String(metadata.support_id) } : {}),
    },
    expand: ["latest_invoice.payment_intent"],
  });

  // `payment_behavior: "default_incomplete"` intentionally leaves the first
  // invoice's PaymentIntent sitting at `requires_confirmation` — Stripe
  // never auto-confirms it for us. Left as-is, the customer would have to
  // find and complete the hosted invoice link before the subscription ever
  // becomes billable (and if they don't within ~23h, it auto-expires into a
  // permanently dead subscription — see isSubscriptionLive() above, added
  // after exactly that happened in a 2026-08 report). Try to confirm it
  // ourselves right away: this succeeds immediately for the vast majority
  // of saved cards (no interactive step needed), and safely falls back to
  // the existing checkout_url flow below for the minority that genuinely
  // need 3DS or an interactive Link confirmation.
  {
    const invoice0 = typeof sub.latest_invoice === "string" ? null : sub.latest_invoice;
    const pi0 =
      invoice0 && invoice0.payment_intent && typeof invoice0.payment_intent !== "string"
        ? invoice0.payment_intent
        : null;
    if (pi0 && pi0.status === "requires_confirmation") {
      try {
        await stripe.paymentIntents.confirm(
          pi0.id,
          defaultPaymentMethod ? { payment_method: defaultPaymentMethod } : undefined,
        );
        sub = await stripe.subscriptions.retrieve(sub.id, { expand: ["latest_invoice"] });
      } catch {
        // Declined, requires 3DS, etc. — leave the subscription incomplete;
        // the checkout_url fallback below lets the customer complete it.
      }
    }
  }

  const admin = createSupabaseAdminClient();
  await admin
    .from("contracts")
    .update({
      stripe_subscription_id: sub.id,
      status:
        sub.status === "active" ? "active" :
        sub.status === "past_due" ? "past_due" :
        sub.status === "canceled" ? "canceled" :
        sub.status === "incomplete" || sub.status === "incomplete_expired" ? "incomplete" :
        "active",
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
    })
    .eq("id", contract.id);
  const invoice = typeof sub.latest_invoice === "string" ? null : sub.latest_invoice;
  const statusNeedsPayment = ["incomplete", "past_due", "unpaid"].includes(sub.status);
  const checkoutUrl = invoice?.hosted_invoice_url ?? null;
  const itemId = sub.items.data[0]?.id ?? null;
  return {
    subscriptionId: sub.id,
    initialItemId: itemId,
    checkoutUrl,
    requiresPayment: statusNeedsPayment || Boolean(checkoutUrl),
  };
}

function toQuantity(monthlyAmount: number, baseUnitAmount: number): number {
  if (baseUnitAmount <= 0) return 0;
  return Math.max(1, Math.round(monthlyAmount / baseUnitAmount));
}

/**
 * この支援行を請求する契約を決める（1頭＝1サブスクリプション）。
 *
 * 契約の Stripe サブスクリプションが生きている（＝ほかの馬を請求している）か、
 * 契約にほかの有効な支援行がぶら下がっている場合は、この馬専用の支援契約を
 * 新しく作り、支援行をそこへ移す。以前はここで既存のサブスクリプションに
 * 2頭目以降をアイテムとして追加していたため、
 *   - 追加した馬の初月が「次回更新日までの日割り」になり、¥5,325 などの
 *     端数が請求された（2026-09 報告: gorokonapon@docomo.ne.jp ほか）、
 *   - 複数の馬が1つのサブスクリプションにまとまり、1頭だけを
 *     「次回更新日で停止」できなかった（停止は即時削除＋日割りの相殺になり、
 *     次回の請求額が端数になっていた）。
 * 専用の契約には、Webhook（契約単位でステータスを反映）もそのまま使える。
 *
 * 移していない（そのまま使える）場合は `movedFrom` が null。
 */
async function ensureDedicatedContract(
  stripe: Stripe,
  contract: ContractRow,
  supportId: string,
  customerId: string,
): Promise<{ contract: ContractRow; movedFrom: string | null }> {
  const admin = createSupabaseAdminClient();
  const hasLiveSubscription =
    !!contract.stripe_subscription_id && (await isSubscriptionLive(stripe, contract.stripe_subscription_id));
  const { count, error: countErr } = await admin
    .from("support_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contract.id)
    .neq("id", supportId)
    .in("status", ["active", "past_due", "incomplete"]);
  // 件数を確認できない場合は、ほかの支援行がある前提で専用の契約を作る（安全側）。
  const hasOtherRows = countErr ? true : (count ?? 0) > 0;
  // 支援プランの契約だけを使う（過去のデータには、リタポ等の契約に支援行が
  // 付いているものがある。そこへ支援の請求を載せると会員種別の判定が狂う）。
  const { data: prev } = await admin
    .from("contracts")
    .select("plan_id, plan:membership_plans(code)")
    .eq("id", contract.id)
    .maybeSingle();
  const isSupportContract = (prev as any)?.plan?.code === "SUPPORT";
  if (!hasLiveSubscription && !hasOtherRows && isSupportContract) {
    return { contract: { ...contract, stripe_subscription_id: null }, movedFrom: null };
  }

  let planId = isSupportContract ? (((prev as any)?.plan_id as string | null) ?? null) : null;
  if (!planId) {
    const { data: supportPlan } = await admin
      .from("membership_plans")
      .select("id")
      .eq("code", "SUPPORT")
      .order("is_active", { ascending: false })
      .order("sort_order")
      .limit(1)
      .maybeSingle();
    planId = ((supportPlan as any)?.id as string | null) ?? null;
  }
  const { data: created, error: cErr } = await admin
    .from("contracts")
    .insert({
      customer_id: customerId,
      plan_id: planId,
      status: "incomplete",
    })
    .select("id, stripe_subscription_id, status")
    .single();
  if (cErr || !created) throw new Error("支援用の契約を作成できませんでした。");

  const { error: mvErr } = await admin
    .from("support_subscriptions")
    .update({ contract_id: (created as any).id })
    .eq("id", supportId);
  if (mvErr) {
    await admin
      .from("contracts")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", (created as any).id);
    throw new Error("支援用の契約を作成できませんでした。");
  }
  return {
    contract: {
      id: (created as any).id,
      stripe_subscription_id: null,
      status: (created as any).status,
    },
    movedFrom: contract.id,
  };
}

/** ensureDedicatedContract で移した支援行を元の契約へ戻し、作った契約を閉じる（失敗時）。 */
async function undoDedicatedContract(supportId: string, movedFrom: string, createdId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from("support_subscriptions").update({ contract_id: movedFrom }).eq("id", supportId);
  await admin
    .from("contracts")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", createdId)
    .is("stripe_subscription_id", null);
}

/**
 * Create or update the Stripe subscription item for a given support row.
 * Safe to call with or without Stripe configured; returns synced=false
 * when Stripe is disabled so the caller can continue DB-only work.
 *
 * 請求の規則（公平で、端数が出ない形）:
 *   - 新しく請求を始める支援行は、その馬専用のサブスクリプションを作り、
 *     月額を満額で請求する（以後は申込日を更新日として毎月同額）。
 *   - 請求中のアイテムの口数変更は、次回の請求日から新しい月額を適用する
 *     （proration_behavior: "none"）。月の途中の差額を日割りで請求・相殺しない。
 */
export async function syncSupportCreate(params: {
  customer: CustomerRow;
  contract: ContractRow;
  support: {
    id: string;
    horse_id: string;
    horse_name?: string | null;
    monthly_amount: number;
  };
  existing_item_id?: string | null;
}): Promise<SupportSyncResult> {
  const stripe = getStripe();
  if (!stripe) return { synced: false, reason: "stripe_disabled" };
  const base = await ensureSupportBasePrice();
  if (!base) return { synced: false, reason: "base_price_missing" };

  const stripeCustomerId = await ensureStripeCustomer(params.customer);
  if (!stripeCustomerId) return { synced: false, reason: "customer_creation_failed" };

  const qty = toQuantity(params.support.monthly_amount, base.unit_amount);
  const metadata: Stripe.MetadataParam = {
    support_id: params.support.id,
    horse_id: params.support.horse_id,
    horse_name: params.support.horse_name ?? "",
  };

  // Reuse the existing item — but ONLY if Stripe still has it. A stored item
  // id routinely outlives the item itself (staff deleted it in the dashboard,
  // a "stop" removed it, the subscription expired). Updating blind either
  // threw a raw Stripe error at the member or, worse, let the caller believe
  // the quantity had been changed when nothing was billed. Fall through to the
  // create/heal path when it is gone.
  // 初回決済が済んでいないサブスクリプションを、別の口数で申し込み直した場合に
  // 取り消す対象（申込時の請求書は元の口数の金額のままなので、そのまま使うと
  // 実際の口数と支払額が食い違う）。新しいサブスクリプションを作った後に取り消す。
  let supersededIncomplete: { subscription: Stripe.Subscription; itemId: string } | null = null;
  if (params.existing_item_id) {
    const live = await getLiveItemAndSubscription(stripe, params.existing_item_id);
    if (live && live.subscription.status === "incomplete" && (live.item.quantity ?? 0) !== qty) {
      supersededIncomplete = { subscription: live.subscription, itemId: live.item.id };
    } else if (live) {
      // 口数の変更は次回の請求日から適用する（日割りの請求・相殺はしない）。
      // 以前は増やすと差額の日割りをその場で請求（always_invoice）、減らすと
      // 次回請求で日割り相殺（create_prorations）しており、どちらも請求額が
      // 月額と異なる端数になっていた（2026-09 報告）。
      const item = await stripe.subscriptionItems.update(params.existing_item_id, {
        quantity: qty,
        metadata,
        proration_behavior: "none",
      });
      const sub = live.subscription;
      await clearScheduledCancel(stripe, sub.id);
      // 初回決済がまだのサブスクリプションは、申込時の請求書の支払いへ案内する。
      const pendingUrl = await pendingFirstInvoiceUrl(stripe, sub);
      const admin = createSupabaseAdminClient();
      await admin
        .from("support_subscriptions")
        .update({ stripe_subscription_item_id: item.id, canceled_at: null })
        .eq("id", params.support.id);
      return {
        synced: true,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: sub.id,
        stripe_subscription_item_id: item.id,
        checkout_url: pendingUrl,
        requires_payment: Boolean(pendingUrl),
        contract_id: params.contract.id,
        effective_from: periodEndIso(sub),
      };
    }
  }

  // A previously-linked subscription can have died since (canceled, or
  // auto-expired from `incomplete` because the customer never completed an
  // initial 3DS/Link confirmation) without our DB ever finding out. Treat
  // that the same as "no subscription yet" instead of crashing with a raw
  // "No such subscription" / "cannot update ... incomplete_expired" error
  // (reported 2026-08: this permanently broke every future edit for a
  // contract's horses once its subscription died).
  //
  // 請求を新しく始めるときは、必ずこの馬専用のサブスクリプションを作る
  // （既存のサブスクリプションへ追加しない）。ensureDedicatedContract を参照。
  const target = await ensureDedicatedContract(stripe, params.contract, params.support.id, params.customer.id);
  let ensured: Awaited<ReturnType<typeof ensureContractSubscription>>;
  try {
    ensured = await ensureContractSubscription(
      target.contract,
      stripeCustomerId,
      base.stripe_price_id,
      qty,
      metadata,
      params.support.horse_name ? `支援: ${params.support.horse_name}` : undefined,
    );
  } catch (e) {
    if (target.movedFrom) await undoDedicatedContract(params.support.id, target.movedFrom, target.contract.id);
    throw e;
  }
  const admin = createSupabaseAdminClient();
  if (ensured.initialItemId) {
    // A row healed back onto a fresh subscription is live again — clear
    // any stale "canceled" status left over from the dead subscription
    // (the webhook's contract-wide cascade only re-activates rows already
    // in active/past_due/incomplete, so a canceled row would otherwise
    // stay stuck displaying "canceled" forever despite billing fine).
    await admin
      .from("support_subscriptions")
      .update({
        stripe_subscription_item_id: ensured.initialItemId,
        status: ensured.requiresPayment ? "incomplete" : "active",
        canceled_at: null,
      })
      .eq("id", params.support.id);
  }
  if (supersededIncomplete) await retireIncompleteSubscription(stripe, supersededIncomplete);
  return {
    synced: true,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: ensured.subscriptionId,
    stripe_subscription_item_id: ensured.initialItemId,
    checkout_url: ensured.checkoutUrl,
    requires_payment: ensured.requiresPayment,
    contract_id: target.contract.id,
    effective_from: null,
  };
}

/**
 * 申し込み直しで不要になった、初回決済前（incomplete）のサブスクリプションを片付ける。
 * 未払いの請求書を無効にしてから取り消すので、古いお支払いページから誤って
 * 支払われることはない。失敗しても、Stripe が 23 時間後に自動で失効させ請求書を
 * 無効にするため、請求は発生しない（best-effort）。
 */
async function retireIncompleteSubscription(
  stripe: Stripe,
  target: { subscription: Stripe.Subscription; itemId: string },
): Promise<void> {
  try {
    const sub = await stripe.subscriptions.retrieve(target.subscription.id);
    if (sub.status !== "incomplete") return;
    if (sub.items.data.length > 1) {
      // ほかの馬も載っている古い形のサブスクリプション: この馬のアイテムだけ外す
      await stripe.subscriptionItems.del(target.itemId, { proration_behavior: "none" });
      return;
    }
    const invoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
    if (invoiceId) {
      const inv = await stripe.invoices.retrieve(invoiceId);
      if (inv.status === "open") await stripe.invoices.voidInvoice(invoiceId);
    }
    await stripe.subscriptions.cancel(sub.id);
  } catch {
    // best-effort（上記のとおり、残っても請求は発生しない）
  }
}

export async function syncSupportUpdate(params: {
  support_id: string;
  stripe_subscription_item_id: string | null;
  monthly_amount: number;
  horse_name?: string | null;
}): Promise<SupportSyncResult> {
  const stripe = getStripe();
  if (!stripe) return { synced: false, reason: "stripe_disabled" };
  if (!params.stripe_subscription_item_id) return { synced: false, reason: "item_missing" };

  // The stored item can be dead (deleted item / expired subscription). Report
  // that as a typed reason so callers self-heal instead of pattern-matching on
  // Stripe's error text, which previously let a failed 口数 change look like a
  // success in some paths.
  const live = await getLiveItemAndSubscription(stripe, params.stripe_subscription_item_id);
  if (!live) return { synced: false, reason: "item_dead" };

  // Items are priced at the half-口 quantum (¥6,000); quantity scales the amount.
  // 変更は次回の請求日から適用する（日割りの請求・相殺はしない）。syncSupportCreate と同じ規則。
  const qty = toQuantity(params.monthly_amount, SUPPORT_STRIPE_QUANTUM);
  const item = await stripe.subscriptionItems.update(params.stripe_subscription_item_id, {
    quantity: qty,
    metadata: { support_id: params.support_id, horse_name: params.horse_name ?? "" },
    proration_behavior: "none",
  });
  return {
    synced: true,
    stripe_subscription_item_id: item.id,
    stripe_subscription_id: live.subscription.id,
    effective_from: periodEndIso(live.subscription),
  };
}

/**
 * Change the billed 口数 of one support row, addressed by row id, and keep
 * Stripe in lock-step. This is THE entry point for every 口数 change — member
 * self-service and 管理画面 alike.
 *
 * Before this existed, `/api/admin/supports/[id]` wrote `units` /
 * `monthly_amount` straight to Supabase and never called Stripe: staff who
 * "changed 1口 to 半口" for a member saw the change in the admin UI while
 * Stripe kept charging the old amount every month (reported 2026-09, two
 * members over-charged). Any new caller must go through here.
 *
 * `allow_create` controls what happens when the row has no live Stripe item:
 *   - true  (member flows): mint a fresh item/subscription — the member is
 *     actively signing up, so starting billing is what they asked for.
 *   - false (admin flows): report `not_billed_by_stripe` and touch nothing.
 *     Staff-registered rows are invoiced manually; silently creating a
 *     subscription for them would start charging a card without consent.
 */
export async function syncSupportUnitsById(params: {
  support_id: string;
  monthly_amount: number;
  allow_create: boolean;
}): Promise<SupportSyncResult> {
  const stripe = getStripe();
  if (!stripe) return { synced: false, reason: "stripe_disabled" };
  const admin = createSupabaseAdminClient();

  const { data: row } = await admin
    .from("support_subscriptions")
    .select(
      "id, customer_id, contract_id, horse_id, stripe_subscription_item_id, horse:horses(name)",
    )
    .eq("id", params.support_id)
    .maybeSingle();
  if (!row) return { synced: false, reason: "support_missing" };

  const horseName = ((row as any).horse?.name as string | null) ?? null;
  const itemId = ((row as any).stripe_subscription_item_id as string | null) ?? null;

  if (itemId) {
    const updated = await syncSupportUpdate({
      support_id: params.support_id,
      stripe_subscription_item_id: itemId,
      monthly_amount: params.monthly_amount,
      horse_name: horseName,
    });
    if (updated.synced) return updated;
    if (!params.allow_create) return { synced: false, reason: updated.reason ?? "item_dead" };
  } else if (!params.allow_create) {
    return { synced: false, reason: "not_billed_by_stripe" };
  }

  const [{ data: customer }, { data: contract }] = await Promise.all([
    admin
      .from("customers")
      .select("id, email, full_name, stripe_customer_id")
      .eq("id", (row as any).customer_id)
      .maybeSingle(),
    admin
      .from("contracts")
      .select("id, stripe_subscription_id, status")
      .eq("id", (row as any).contract_id)
      .maybeSingle(),
  ]);
  if (!customer || !contract) {
    return { synced: false, reason: "customer_or_contract_missing" };
  }
  return syncSupportCreate({
    customer: customer as any,
    contract: contract as any,
    support: {
      id: params.support_id,
      horse_id: (row as any).horse_id,
      horse_name: horseName,
      monthly_amount: params.monthly_amount,
    },
    existing_item_id: null,
  });
}

/**
 * 支援停止同期。
 *
 * 仕様:
 *   - デフォルトは「次回更新日で停止」(cancel_at_period_end = true)。
 *     誤操作リスクを下げるため、即時解約はしない。
 *   - 最後の1アイテムの場合はサブスクリプション全体を period_end 解約。
 *   - 複数アイテム残る場合は即時アイテム削除（Stripe仕様上、部分の
 *     予約解約が標準では行えないため。必要になった段階で
 *     Subscription Schedule への置き換えを検討する）。
 *   - `immediate=true` を指定した場合のみ、即時解約を行う（管理者用）。
 *
 * 戻り値に `scheduled_cancel_at`（ISO文字列）が含まれる場合、呼び出し
 * 元は DB 側の `canceled_at` にその値を保存し、status は `active` の
 * ままにする（停止予定のUI表示用）。実際に status=`canceled` に落と
 * すのは Webhook（customer.subscription.deleted）の責務。
 */
export async function syncSupportCancel(params: {
  stripe_subscription_item_id: string | null;
  stripe_subscription_id: string | null;
  immediate?: boolean;
}): Promise<SupportCancelResult> {
  const stripe = getStripe();
  if (!stripe) return { synced: false, reason: "stripe_disabled", mode: "noop" };
  if (!params.stripe_subscription_item_id) {
    return { synced: false, reason: "item_missing", mode: "noop" };
  }

  // The stored item id may already be gone. Nothing left to bill means the
  // stop has effectively happened — report it as such so the DB row is closed
  // out rather than left `active` forever.
  const liveItem = await getLiveSubscriptionItem(stripe, params.stripe_subscription_item_id);
  if (!liveItem) {
    return { synced: true, mode: "already_gone", scheduled_cancel_at: null };
  }

  if (params.stripe_subscription_id) {
    // The subscription may already be dead (canceled, or expired from
    // `incomplete`) — that's already the end state a "stop" is asking for,
    // so treat it as already-canceled instead of erroring out.
    let sub: Stripe.Subscription | null = null;
    try {
      sub = await stripe.subscriptions.retrieve(params.stripe_subscription_id);
    } catch (e: any) {
      if (e?.code !== "resource_missing") throw e;
    }
    if (!sub || sub.status === "canceled" || sub.status === "incomplete_expired") {
      return {
        synced: true,
        stripe_subscription_id: params.stripe_subscription_id,
        scheduled_cancel_at: null,
        mode: "already_gone",
      };
    }
    const isLastItem = sub.items.data.length <= 1;

    if (isLastItem) {
      if (params.immediate) {
        await stripe.subscriptions.cancel(params.stripe_subscription_id, {
          invoice_now: false,
          prorate: true,
        });
        return {
          synced: true,
          stripe_subscription_id: sub.id,
          scheduled_cancel_at: null,
          mode: "immediate",
        };
      }
      const updated = await stripe.subscriptions.update(params.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      const scheduled = updated.current_period_end
        ? new Date(updated.current_period_end * 1000).toISOString()
        : null;
      return {
        synced: true,
        stripe_subscription_id: sub.id,
        scheduled_cancel_at: scheduled,
        mode: "scheduled",
      };
    }
  }

  // Multiple items remain: Stripe has no per-item "cancel at period end", so
  // the item is removed NOW. `mode: "immediate"` is what tells the caller to
  // close the DB row instead of marking it "stops at period end".
  await stripe.subscriptionItems.del(params.stripe_subscription_item_id, {
    proration_behavior: "create_prorations",
  });
  return {
    synced: true,
    stripe_subscription_id: params.stripe_subscription_id,
    scheduled_cancel_at: null,
    mode: "immediate",
  };
}

/**
 * Stop billing for one support row, addressed by row id. Shared by the member
 * stop endpoint and 管理画面 so a staff-side stop can never again leave a live
 * Stripe item behind (reported 2026-09: "登録は解除してあります" while both of
 * the member's cards kept being charged).
 */
export async function syncSupportCancelById(params: {
  support_id: string;
  immediate?: boolean;
}): Promise<SupportCancelResult> {
  const stripe = getStripe();
  if (!stripe) return { synced: false, reason: "stripe_disabled", mode: "noop" };
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("support_subscriptions")
    .select(
      "id, stripe_subscription_item_id, contract:contracts(id, stripe_subscription_id)",
    )
    .eq("id", params.support_id)
    .maybeSingle();
  if (!row) return { synced: false, reason: "support_missing", mode: "noop" };

  const itemId = ((row as any).stripe_subscription_item_id as string | null) ?? null;
  // Rows registered by staff are invoiced manually and carry no Stripe item —
  // there is nothing to cancel, and that is a success, not a failure.
  if (!itemId) return { synced: true, reason: "not_billed_by_stripe", mode: "noop" };

  return syncSupportCancel({
    stripe_subscription_item_id: itemId,
    stripe_subscription_id: (row as any).contract?.stripe_subscription_id ?? null,
    immediate: params.immediate,
  });
}
