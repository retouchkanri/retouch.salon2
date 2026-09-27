"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 6.5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const iconBtn =
  "w-8 h-8 shrink-0 rounded-[50%] border border-surface-line bg-white shadow-sm flex items-center justify-center transition-colors disabled:opacity-50";

type SupportView = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  horse_name: string;
  units: number;
  units_label: string;
  monthly_amount: number;
  monthly_label: string;
  status: string;
  status_label: string;
  started_at: string;
  canceled_at: string;
};

export default function SupportRow({ support, index }: { support: SupportView; index: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const perUnit = support.units > 0 ? Math.round(support.monthly_amount / support.units) : 12000;
  const [units, setUnits] = useState(String(support.units));
  const [unitAmount, setUnitAmount] = useState(String(perUnit));
  const [status, setStatus] = useState(support.status);

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/supports/${support.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        units: Number(units),
        unit_amount: Number(unitAmount),
        status,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "保存できませんでした");
      return;
    }
    setEditing(false);
    router.refresh();
  };

  const cancelSupport = async () => {
    if (!confirm("この支援を停止しますか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/supports/${support.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "停止できませんでした");
      return;
    }
    router.refresh();
  };

  const hardDelete = async () => {
    if (!confirm("支援レコードを完全に削除します。復元不可ですが続行しますか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/supports/${support.id}?hard=1`, { method: "DELETE" });
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
          <Link href={`/admin/customers/${support.customer_id}`} className="text-brand underline">
            {support.customer_name}
          </Link>
          <div className="text-xs text-ink-mute">{support.customer_email}</div>
        </td>
        <td>{support.horse_name}</td>
        <td>{support.units_label}</td>
        <td>{support.monthly_label}</td>
        <td>{support.status_label}</td>
        <td>{support.started_at}</td>
        <td>{support.canceled_at}</td>
        <td className="col-actions text-right whitespace-nowrap min-w-[7.5rem]">
          {/* Mobile: sticky right — icon buttons always visible */}
          <div className="flex items-center justify-end gap-1 md:hidden">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-label="編集"
              title="編集"
              className={`${iconBtn} text-brand hover:bg-brand-50 hover:border-brand`}
            >
              <PencilIcon />
            </button>
            {support.status !== "canceled" && (
              <button
                type="button"
                onClick={cancelSupport}
                disabled={busy}
                aria-label="停止"
                title="停止"
                className={`${iconBtn} text-amber-700 hover:bg-amber-50 hover:border-amber-400`}
              >
                <StopIcon />
              </button>
            )}
            <button
              type="button"
              onClick={hardDelete}
              disabled={busy}
              aria-label="削除"
              title="削除"
              className={`${iconBtn} text-danger hover:bg-red-50 hover:border-red-300`}
            >
              <TrashIcon />
            </button>
          </div>
          {/* Desktop: text links */}
          <div className="hidden md:block">
            <button className="text-brand underline text-sm mr-3" onClick={() => setEditing((v) => !v)}>
              編集
            </button>
            {support.status !== "canceled" && (
              <button className="text-amber-700 underline text-sm mr-3" onClick={cancelSupport} disabled={busy}>
                停止
              </button>
            )}
            <button className="text-danger underline text-sm" onClick={hardDelete} disabled={busy}>
              削除
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={9} className="bg-surface-soft">
            <div className="p-3 grid sm:grid-cols-4 gap-3">
              <div>
                <label className="label">口数</label>
                <input type="number" step="0.5" className="input" value={units} onChange={(e) => setUnits(e.target.value)} />
              </div>
              <div>
                <label className="label">単価（円/口）</label>
                <input type="number" className="input" value={unitAmount} onChange={(e) => setUnitAmount(e.target.value)} />
              </div>
              <div>
                <label className="label">状態</label>
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">有効</option>
                  <option value="past_due">決済失敗</option>
                  <option value="canceled">停止</option>
                  <option value="paused">一時停止</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button className="btn-primary" onClick={save} disabled={busy}>
                  保存
                </button>
                <button className="btn-ghost" onClick={() => setEditing(false)}>
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
