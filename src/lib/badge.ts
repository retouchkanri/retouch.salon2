/**
 * Server-side helpers to gather the data the member badge depends on:
 *   - firstPaymentAt: earliest successful payment (drives the "paying ≥ N months" tiers)
 *   - totalPaidYen:   sum of all succeeded payments (drives the gold ¥100,000 threshold)
 *
 * Registration date (customers.joined_at) and RPT status are supplied by the
 * caller, which already has them, and combined via roles.resolveBadge().
 */

import { fetchAllByIds } from "@/lib/fetchAll";

export type PaymentStat = {
  firstPaymentAt: string | null;
  totalPaidYen: number;
};

const EMPTY: PaymentStat = { firstPaymentAt: null, totalPaidYen: 0 };

/** Aggregate succeeded-payment stats for many customers in one query. */
export async function loadPaymentStats(
  client: any,
  customerIds: string[],
): Promise<Map<string, PaymentStat>> {
  const map = new Map<string, PaymentStat>();
  if (!customerIds.length) return map;

  // payments は 16,000 行を超えるため、素のクエリでは PostgREST の 1000 行上限で
  // 黙って打ち切られ、合計額・初回決済日がどちらも過少になる（バッジ判定が狂う）。
  // 顧客 ID をチャンクに割ったうえで、各チャンクを最後までページングする。
  const { rows } = await fetchAllByIds<any>(customerIds, (chunk, from, to) =>
    client
      .from("payments")
      .select("customer_id, amount, occurred_at")
      .in("customer_id", chunk)
      .eq("status", "succeeded")
      .order("id", { ascending: true })
      .range(from, to),
  );

  for (const p of rows) {
    const cid = p.customer_id as string | null;
    if (!cid) continue;
    const cur = map.get(cid) ?? { firstPaymentAt: null, totalPaidYen: 0 };
    cur.totalPaidYen += Number(p.amount ?? 0);
    if (
      p.occurred_at &&
      (!cur.firstPaymentAt || new Date(p.occurred_at) < new Date(cur.firstPaymentAt))
    ) {
      cur.firstPaymentAt = p.occurred_at as string;
    }
    map.set(cid, cur);
  }
  return map;
}

/** Convenience for a single customer. */
export async function loadPaymentStat(
  client: any,
  customerId: string | null,
): Promise<PaymentStat> {
  if (!customerId) return { ...EMPTY };
  const map = await loadPaymentStats(client, [customerId]);
  return map.get(customerId) ?? { ...EMPTY };
}
