"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ContractView = {
  id: string;
  customer_id: string;
  plan_id: string | null;
  status: string;
  started_at: string;
  current_period_end: string | null;
  canceled_at: string;
  stripe_subscription_id: string | null;
  customer_name: string;
  customer_email: string;
  plan_name: string;
  monthly_yen: string;
  status_label: string;
};

export default function ContractRow({ contract, index }: { contract: ContractView; index: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [status, setStatus] = useState(contract.status);

  const periodEndForInput = contract.current_period_end
    ? new Date(contract.current_period_end).toISOString().slice(0, 10)
    : "";
  const [periodEnd, setPeriodEnd] = useState(periodEndForInput);

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/contracts/${contract.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status,
        current_period_end: periodEnd ? new Date(periodEnd).toISOString() : null,
      }),
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

  const cancelContract = async () => {
    if (!confirm(`契約を停止しますか？（Stripeサブスクも同時に解約されます）`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/contracts/${contract.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "停止できませんでした");
      return;
    }
    router.refresh();
  };

  const hardDelete = async () => {
    if (!confirm("契約レコードを完全に削除します。復元不可ですがよろしいですか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/contracts/${contract.id}?hard=1`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "削除できませんでした");
      return;
    }
    router.refresh();
  };

  return (
    <>
      <tr>
        <td className="text-right text-ink-mute tabular-nums">{index}</td>
        <td>
          <Link href={`/admin/customers/${contract.customer_id}`} className="text-brand underline">
            {contract.customer_name}
          </Link>
          <div className="text-xs text-ink-mute">{contract.customer_email}</div>
        </td>
        <td>{contract.plan_name}</td>
        <td>{contract.monthly_yen}</td>
        <td>{contract.status_label}</td>
        <td>{contract.started_at}</td>
        <td>{periodEndForInput || "—"}</td>
        <td>{contract.canceled_at}</td>
        <td className="font-mono text-[11px]">{contract.stripe_subscription_id ?? "—"}</td>
        <td className="text-right whitespace-nowrap col-actions">
          <button className="text-brand underline text-sm mr-3" onClick={() => setShowEdit((v) => !v)}>
            編集
          </button>
          {contract.status !== "canceled" && (
            <button className="text-amber-700 underline text-sm mr-3" onClick={cancelContract} disabled={busy}>
              停止
            </button>
          )}
          <button className="text-danger underline text-sm" onClick={hardDelete} disabled={busy}>
            削除
          </button>
        </td>
      </tr>
      {showEdit && (
        <tr>
          <td colSpan={10} className="bg-surface-soft">
            <div className="p-3 grid sm:grid-cols-3 gap-3">
              <div>
                <label className="label">状態</label>
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">有効</option>
                  <option value="past_due">決済失敗</option>
                  <option value="canceled">停止</option>
                  <option value="paused">一時停止</option>
                  <option value="incomplete">手続き中</option>
                </select>
              </div>
              <div>
                <label className="label">次回決済日</label>
                <input type="date" className="input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
              <div className="flex items-end gap-2">
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
