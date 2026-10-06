/**
 * 決済の一覧を「Stripe の支払い 1 件につき 1 行」にそろえる。
 *
 * payments には、同じ支払いについて2種類の行が入る。Stripe 同期が入れる決済の行（決済IDあり）と、
 * Webhook が入れる控えの行（イベントIDあり・決済IDなし。請求明細を持つ）。一覧にそのまま出すと同じ支払いが2行になる。
 */

/**
 * 一覧用の絞り込み。Webhook の控えの行（決済IDなし）を除く。
 * Stripe 同期が済んでいれば、残るのは Stripe の決済（1 件 1 行）と、Stripe を通らない手入力の入金だけになる。
 */
export const CANONICAL_PAYMENTS_FILTER = "stripe_charge_id.not.is.null,stripe_event_id.is.null";

type Row = {
  status: string;
  stripe_charge_id?: string | null;
  stripe_event_id?: string | null;
  stripe_invoice_id?: string | null;
  stripe_payment_intent_id?: string | null;
};

const paid = (status: string) => status === "succeeded" || status === "refunded";

/**
 * 読み込んだ行から、Webhook の控えの行を落とす。
 * 同期がまだ追いついていない支払い（控えの行しか無い）は消さない。会員の決済履歴のように、
 * 支払った直後に見られる画面で使う。
 */
export function canonicalPayments<T extends Row>(rows: T[]): T[] {
  const keyOf = (row: Row) => (row.stripe_invoice_id ? `in:${row.stripe_invoice_id}` : row.stripe_payment_intent_id ? `pi:${row.stripe_payment_intent_id}` : null);
  // 同じ請求・同じ決済について、決済の行がすでにある結果（入金済み／失敗）
  const settled = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key && row.stripe_charge_id) settled.add(`${key}:${paid(row.status) ? "paid" : row.status}`);
  }
  return rows.filter((row) => {
    if (row.stripe_charge_id || !row.stripe_event_id) return true;
    const key = keyOf(row);
    return !(key && settled.has(`${key}:${paid(row.status) ? "paid" : row.status}`));
  });
}
