"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatYen, statusLabel } from "@/lib/format";

export type PaymentItem = {
  id: string;
  occurred_at: string | null;
  kind: string;
  amount: number;
  status: string;
  failure_reason: string | null;
  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;
};

// 決済種別の日本語表示。未知の値はそのまま表示する。
const KIND_LABEL: Record<string, string> = {
  subscription: "継続課金",
  donation: "寄付",
  one_time: "単発",
};

/**
 * 顧客ごとの決済履歴。寄付の取消や誤登録など、身に覚えのない決済レコードは
 * 「削除」で取り除ける（DELETE /api/admin/payments/[id]）。Stripe側は変更されない。
 * 削除ボタンは payments.manage 権限（管理者・オーナー）の場合のみ表示する。
 */
export default function PaymentHistory({
  payments,
  canDelete,
}: {
  payments: PaymentItem[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function remove(p: PaymentItem) {
    const label = `${formatDate(p.occurred_at, true)} / ${KIND_LABEL[p.kind] ?? p.kind} / ${formatYen(p.amount)}`;
    if (
      !window.confirm(
        `この決済レコードを完全に削除しますか？\n${label}\n\nStripe側のデータは変更されません。この操作は元に戻せません。`,
      )
    )
      return;
    setBusy(p.id);
    setErr(null);
    const res = await fetch(`/api/admin/payments/${p.id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "削除に失敗しました。");
      return;
    }
    router.refresh();
  }

  return (
    <>
      {err && <p className="text-danger text-sm mb-2">{err}</p>}
      <table className="table">
        <thead>
          <tr>
            <th className="w-12 text-right">No.</th>
            <th>日時</th>
            <th>種別</th>
            <th>金額</th>
            <th>状態</th>
            <th>失敗理由</th>
            <th>Stripe請求/決済ID</th>
            {canDelete && <th></th>}
          </tr>
        </thead>
        <tbody>
          {payments.map((p, i) => {
            const stripeId = p.stripe_invoice_id || p.stripe_payment_intent_id || "";
            return (
              <tr key={p.id}>
                <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                <td>{formatDate(p.occurred_at, true)}</td>
                <td>{KIND_LABEL[p.kind] ?? p.kind}</td>
                <td>{formatYen(p.amount)}</td>
                <td>{statusLabel(p.status)}</td>
                <td className="text-xs">{p.failure_reason ?? "—"}</td>
                <td className="font-mono text-[11px] max-w-[200px] truncate" title={stripeId}>
                  {stripeId || "—"}
                </td>
                {canDelete && (
                  <td className="text-right">
                    <button
                      className="text-danger underline text-sm disabled:opacity-50"
                      onClick={() => remove(p)}
                      disabled={busy === p.id}
                    >
                      {busy === p.id ? "削除中..." : "削除"}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          {payments.length === 0 && (
            <tr>
              <td colSpan={canDelete ? 8 : 7} className="text-center text-ink-mute py-3">
                決済履歴はまだありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
