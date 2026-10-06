/**
 * いま Stripe で有効な一口支援（定期課金）。経営管理の当月の「一口支援の月額」に使う。
 * 過去の月は、その月に Stripe が課金した請求から出す（monthlyReport.ts の billedSupport）。
 */
import { unstable_cache } from "next/cache";
import type Stripe from "stripe";
import {
  SUPPORT_UNIT_YEN,
  currentYearMonth,
  incomeKindOfLine,
  monthStart,
  parseYearMonth,
  shiftMonth,
  type LiveSupport,
} from "@/lib/monthlyReport";
import { getStripe } from "@/lib/stripe";

type LiveItem = { status: string; customer: string; productName: string; monthlyYen: number };

/** 月額に直す。毎月課金以外（年額など）は月割りにする。 */
function monthlyYen(item: Stripe.SubscriptionItem): number {
  const amount = (item.price.unit_amount ?? 0) * (item.quantity ?? 1);
  const recurring = item.price.recurring;
  if (!recurring) return 0;
  const count = recurring.interval_count || 1;
  if (recurring.interval === "month") return Math.round(amount / count);
  if (recurring.interval === "year") return Math.round(amount / (12 * count));
  if (recurring.interval === "week") return Math.round((amount * 52) / (12 * count));
  return Math.round((amount * 365) / (12 * count));
}

/** 一口支援の定期課金を、支払い中（active / trialing）と支払い遅延（past_due）に分けて合計する。 */
export function summarizeLiveSupport(items: LiveItem[], ym: string): LiveSupport {
  let yen = 0;
  let pastDueYen = 0;
  const supporters = new Set<string>();
  for (const item of items) {
    if (incomeKindOfLine(item.productName) !== "share" || item.monthlyYen <= 0) continue;
    if (item.status === "past_due") {
      pastDueYen += item.monthlyYen;
      continue;
    }
    if (item.status !== "active" && item.status !== "trialing") continue;
    yen += item.monthlyYen;
    supporters.add(item.customer);
  }
  return { ym, yen, supporters: supporters.size, units: Math.round((yen / SUPPORT_UNIT_YEN) * 2) / 2, pastDueYen };
}

async function fetchLiveSupport(): Promise<LiveSupport | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const productNames = new Map<string, string>();
  for (const active of [true, false]) {
    for await (const product of stripe.products.list({ limit: 100, active })) productNames.set(product.id, product.name);
  }

  const items: LiveItem[] = [];
  for (const status of ["active", "trialing", "past_due"] as const) {
    for await (const subscription of stripe.subscriptions.list({ status, limit: 100, expand: ["data.customer"] })) {
      let list = subscription.items.data;
      // 一覧に埋め込まれる項目は先頭10件まで。超える分は取り直す。
      if (subscription.items.has_more) {
        list = [];
        for await (const item of stripe.subscriptionItems.list({ subscription: subscription.id, limit: 100 })) list.push(item);
      }
      // 同じ人が Stripe の顧客を複数持っていることがある（旧サイトは申込みごとに顧客を作っていた）。
      // 人数はメールアドレスで数える。
      const owner = subscription.customer;
      const email = typeof owner !== "string" && !owner.deleted ? owner.email : null;
      const customer = email?.trim().toLowerCase() || (typeof owner === "string" ? owner : owner.id);
      for (const item of list) {
        const product = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
        items.push({ status: subscription.status, customer, productName: productNames.get(product) ?? "", monthlyYen: monthlyYen(item) });
      }
    }
  }
  return summarizeLiveSupport(items, currentYearMonth());
}

/**
 * 決済ごとの手数料とは別に、Stripe が残高から引く利用料（Billing の利用料、Sigma など）。
 * Stripe の残高レポートでは「手数料（fee）」の区分に出る。決済には紐付かないので、その月の残高の記録から読む。
 */
async function fetchOtherFees(ym: string): Promise<{ yen: number; count: number } | null> {
  const stripe = getStripe();
  const parsed = parseYearMonth(ym);
  if (!stripe || !parsed) return null;
  const next = shiftMonth(parsed.year, parsed.month, 1);
  const created = {
    gte: Math.floor(monthStart(parsed.year, parsed.month).getTime() / 1000),
    lt: Math.floor(monthStart(next.year, next.month).getTime() / 1000),
  };
  let yen = 0;
  let count = 0;
  for (const type of ["stripe_fee", "adjustment"] as const) {
    for await (const txn of stripe.balanceTransactions.list({ limit: 100, created, type })) {
      if (txn.reporting_category !== "fee") continue;
      yen -= txn.net;
      count += 1;
    }
  }
  return { yen, count };
}

const cachedOtherFees = unstable_cache(fetchOtherFees, ["stripe-other-fees"], { revalidate: 600 });

export async function loadStripeOtherFees(ym: string): Promise<{ yen: number; count: number } | null> {
  try {
    return await cachedOtherFees(ym);
  } catch {
    return fetchOtherFees(ym);
  }
}

// Stripe の定期課金を全部たどるので数秒かかる。10分は同じ結果を使う。
const cachedLiveSupport = unstable_cache(fetchLiveSupport, ["stripe-live-support"], { revalidate: 600 });

export async function loadLiveSupport(): Promise<LiveSupport | null> {
  try {
    return await cachedLiveSupport();
  } catch {
    // Next.js の外（スクリプトやテスト）ではキャッシュが使えない。そのまま取りに行く。
    return fetchLiveSupport();
  }
}
