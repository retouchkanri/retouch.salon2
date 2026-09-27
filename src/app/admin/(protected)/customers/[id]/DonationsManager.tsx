"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Donation = {
  id: string;
  amount: number;
  message: string | null;
  status: string;
  donated_at: string;
};

function formatYen(v: number) {
  return `¥${v.toLocaleString("ja-JP")}`;
}
function formatDateTime(v: string) {
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const statusOptions = [
  { value: "succeeded", label: "成立" },
  { value: "pending", label: "保留中" },
  { value: "failed", label: "失敗" },
  { value: "refunded", label: "返金" },
  { value: "canceled", label: "取消" },
];

export default function DonationsManager({
  customerId,
  donations,
}: {
  customerId: string;
  donations: Donation[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("3000");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("pending");

  const create = async () => {
    setErr(null);
    setBusy("__add");
    const res = await fetch("/api/admin/donations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId,
        amount: Number(amount),
        message: message || null,
        status,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.error ?? "登録に失敗しました");
    setAddOpen(false);
    setAmount("3000");
    setMessage("");
    setStatus("succeeded");
    router.refresh();
  };

  const refund = async (id: string) => {
    if (!confirm("この寄付を返金として記録します。よろしいですか？")) return;
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/admin/donations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "refunded" }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "更新に失敗しました");
    }
    router.refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("この寄付履歴を削除します。よろしいですか？")) return;
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/admin/donations/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "削除に失敗しました");
    }
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-mute">{donations.length}件</p>
        {!addOpen ? (
          <button className="btn-primary !py-1.5 !px-3 text-sm" onClick={() => setAddOpen(true)}>
            ＋ 寄付を記録
          </button>
        ) : (
          <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setAddOpen(false)}>
            キャンセル
          </button>
        )}
      </div>

      {addOpen && (
        <div className="grid md:grid-cols-4 gap-2 p-3 bg-surface-soft rounded-xl border border-surface-line">
          <div>
            <label className="label">金額（円）</label>
            <input
              className="input"
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">状態</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">メッセージ（任意）</label>
            <input
              className="input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="md:col-span-4">
            <button className="btn-primary" onClick={create} disabled={busy === "__add"}>
              {busy === "__add" ? "登録中..." : "登録する"}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-danger text-sm">{err}</p>}

      <table className="table">
        <thead>
          <tr>
            <th className="w-12 text-right">No.</th>
            <th>日時</th>
            <th>金額</th>
            <th>状態</th>
            <th>メッセージ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {donations.map((d, i) => (
            <tr key={d.id}>
              <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
              <td>{formatDateTime(d.donated_at)}</td>
              <td>{formatYen(d.amount)}</td>
              <td>{d.status}</td>
              <td className="text-xs">{d.message ?? "—"}</td>
              <td className="text-right">
                <div className="flex gap-1 justify-end">
                  {d.status === "succeeded" && (
                    <button
                      className="btn-secondary !py-1 !px-2 text-xs"
                      onClick={() => refund(d.id)}
                      disabled={busy === d.id}
                    >
                      返金
                    </button>
                  )}
                  <button
                    className="btn-danger !py-1 !px-2 text-xs"
                    onClick={() => remove(d.id)}
                    disabled={busy === d.id}
                  >
                    削除
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {donations.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center text-ink-mute py-3">
                寄付履歴はまだありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
