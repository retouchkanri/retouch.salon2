"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PaymentView = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string;
  amount: number;
  amount_label: string;
  currency: string;
  payment_method: string;
  description: string;
  status: string;
  status_label: string;
  failure_reason: string;
  occurred_at: string;
  refund_date: string;
  stripe_invoice_id: string;
  stripe_payment_intent_id: string;
  stripe_charge_id: string;
};

export default function PaymentRow({ payment }: { payment: PaymentView }) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(payment.status);
  const [amount, setAmount] = useState(String(payment.amount));
  const [failureReason, setFailureReason] = useState(payment.failure_reason);

  const stripeId = payment.stripe_invoice_id || payment.stripe_payment_intent_id || payment.stripe_charge_id;

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/payments/${payment.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, amount: Number(amount), failure_reason: failureReason || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "保存できませんでした");
      return;
    }
    setShowEdit(false);
    router.refresh();
  };

  const remove = async () => {
    if (!confirm("この決済レコードを削除しますか？（Stripe側は変更されません）")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/payments/${payment.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "削除できませんでした");
      return;
    }
    router.refresh();
  };

  const statusChip =
    payment.status === "succeeded"
      ? "chip-ok"
      : payment.status === "failed"
      ? "chip-error"
      : payment.status === "refunded"
      ? "chip-warn"
      : "chip-mute";

  return (
    <>
      <tr>
        <td className="whitespace-nowrap">
          <span className="font-semibold tabular-nums">{payment.amount_label}</span>
          <span className="text-xs text-ink-mute ml-1">{payment.currency}</span>
          <span className={`${statusChip} ml-2`}>{payment.status_label}</span>
        </td>
        <td className="whitespace-nowrap text-sm">{payment.payment_method}</td>
        <td className="text-sm max-w-[200px] truncate" title={payment.description}>
          {payment.description || "—"}
        </td>
        <td>
          {payment.customer_id ? (
            <Link href={`/admin/customers/${payment.customer_id}`} className="text-brand underline">
              {payment.customer_name || payment.customer_email || "—"}
            </Link>
          ) : (
            <span className="font-medium">{payment.customer_name || payment.customer_email || "—"}</span>
          )}
          {payment.customer_email && (payment.customer_name !== payment.customer_email) && (
            <div className="text-xs text-ink-mute">{payment.customer_email}</div>
          )}
        </td>
        <td className="whitespace-nowrap tabular-nums text-sm">{payment.occurred_at}</td>
        <td className="whitespace-nowrap text-sm">{payment.refund_date || "—"}</td>
        <td className="text-xs text-ink-soft max-w-[180px] truncate" title={payment.failure_reason}>
          {payment.failure_reason || "—"}
        </td>
        <td className="font-mono text-[11px] max-w-[160px] truncate" title={stripeId}>
          {stripeId || "—"}
        </td>
        <td className="text-right whitespace-nowrap">
          <button className="text-brand underline text-sm mr-3" onClick={() => setShowEdit((v) => !v)}>
            編集
          </button>
          <button className="text-danger underline text-sm" onClick={remove} disabled={busy}>
            削除
          </button>
        </td>
      </tr>
      {showEdit && (
        <tr>
          <td colSpan={9} className="bg-surface-soft">
            <div className="p-3 grid sm:grid-cols-4 gap-3">
              <div>
                <label className="label">状態</label>
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="succeeded">成功</option>
                  <option value="failed">失敗</option>
                  <option value="pending">保留</option>
                  <option value="refunded">返金済</option>
                  <option value="canceled">取消</option>
                </select>
              </div>
              <div>
                <label className="label">金額（円）</label>
                <input type="number" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">失敗理由メモ</label>
                <input className="input" value={failureReason} onChange={(e) => setFailureReason(e.target.value)} />
              </div>
              <div className="sm:col-span-4 flex gap-2">
                <button className="btn-primary" onClick={save} disabled={busy}>
                  保存
                </button>
                <button className="btn-ghost" onClick={() => setShowEdit(false)}>
                  閉じる
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
