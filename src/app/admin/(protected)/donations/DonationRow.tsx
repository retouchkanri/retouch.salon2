"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type DonationView = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string;
  donor_name: string;
  donor_email: string;
  amount: number;
  amount_label: string;
  status: string;
  status_label: string;
  message: string;
  payment_method: string;
  payment_method_label: string;
  confirmed_at_label: string;
  confirmed_at_value: string;
  note: string;
  donated_at: string;
  donated_at_value: string;
  is_member: boolean;
  member_type_label: string | null;
};

export default function DonationRow({ donation, index }: { donation: DonationView; index: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(donation.amount));
  const [status, setStatus] = useState(donation.status);
  const [donorName, setDonorName] = useState(donation.donor_name);
  const [donorEmail, setDonorEmail] = useState(donation.donor_email);
  const [message, setMessage] = useState(donation.message);
  const [paymentMethod, setPaymentMethod] = useState(donation.payment_method || "card");
  const [confirmedAt, setConfirmedAt] = useState(donation.confirmed_at_value);
  const [donatedAt, setDonatedAt] = useState(donation.donated_at_value);
  const [note, setNote] = useState(donation.note);
  const [statusVal, setStatusVal] = useState(donation.status);

  // 一覧から直接ステータスを変更する（編集を開かずワンタップ）。
  const changeStatus = async (newStatus: string) => {
    const prev = statusVal;
    setStatusVal(newStatus);
    setBusy(true);
    const res = await fetch(`/api/admin/donations/${donation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "状態を変更できませんでした");
      setStatusVal(prev);
      return;
    }
    router.refresh();
  };

  // 銀行振込の入金確認：確認日を本日にし、状態を「成功」に更新する。
  const confirmBank = async () => {
    if (!confirm("入金を確認済みにします。よろしいですか？（状態を「成功」に更新します）")) return;
    setBusy(true);
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`/api/admin/donations/${donation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed_at: today, status: "succeeded" }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "入金確認を登録できませんでした");
      return;
    }
    setStatusVal("succeeded");
    router.refresh();
  };

  const save = async () => {
    setBusy(true);
    const payload: Record<string, unknown> = {
      amount: Number(amount),
      status,
      donor_name: donorName || null,
      message: message || null,
      payment_method: paymentMethod,
      confirmed_at: confirmedAt || null,
      note: note || null,
    };
    if (donatedAt) payload.donated_at = donatedAt;
    if (donorEmail) payload.donor_email = donorEmail;
    const res = await fetch(`/api/admin/donations/${donation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
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

  const remove = async () => {
    if (!confirm("この寄付レコードを削除しますか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/donations/${donation.id}`, { method: "DELETE" });
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
        <td className="whitespace-nowrap">{donation.donated_at}</td>
        <td>
          {donation.donor_name || <span className="text-ink-mute">匿名</span>}
          <div className="text-xs text-ink-mute">{donation.donor_email}</div>
        </td>
        <td>
          <span
            className={`inline-block mb-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
              donation.is_member ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
            }`}
          >
            {donation.is_member
              ? donation.member_type_label ?? "会員"
              : "単発支援"}
          </span>
          <br />
          {donation.customer_id ? (
            <Link href={`/admin/customers/${donation.customer_id}`} className="text-brand underline">
              {donation.customer_name}
            </Link>
          ) : (
            <span className="text-ink-mute">—</span>
          )}
        </td>
        <td>{donation.amount_label}</td>
        <td>
          <select
            className="border border-surface-line rounded-lg bg-white px-2 py-1 text-sm disabled:opacity-50"
            value={statusVal}
            onChange={(e) => changeStatus(e.target.value)}
            disabled={busy}
            aria-label="状態を変更"
          >
            <option value="succeeded">成功</option>
            <option value="pending">保留</option>
            <option value="failed">失敗</option>
            <option value="refunded">返金済</option>
            <option value="canceled">取消</option>
          </select>
        </td>
        <td>
          <span className={donation.payment_method === "bank_transfer" ? "chip-warn" : "chip-mute"}>
            {donation.payment_method_label}
          </span>
        </td>
        <td className="whitespace-nowrap">
          {donation.confirmed_at_label ? (
            donation.confirmed_at_label
          ) : donation.payment_method === "bank_transfer" ? (
            <button
              className="text-sm font-semibold text-amber-800 underline disabled:opacity-50"
              onClick={confirmBank}
              disabled={busy}
            >
              入金確認
            </button>
          ) : (
            "—"
          )}
        </td>
        <td className="text-xs max-w-[220px] truncate" title={donation.message}>
          {donation.message || "—"}
        </td>
        <td className="text-xs max-w-[200px] truncate" title={donation.note}>
          {donation.note || "—"}
        </td>
        <td className="text-right whitespace-nowrap col-actions">
          <button className="text-brand underline text-sm mr-3" onClick={() => setEditing((v) => !v)}>
            編集
          </button>
          <button className="text-danger underline text-sm" onClick={remove} disabled={busy}>
            削除
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={11} className="bg-surface-soft">
            <div className="p-3 grid sm:grid-cols-4 gap-3">
              <div>
                <label className="label">金額</label>
                <input type="number" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <label className="label">状態</label>
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="succeeded">成功</option>
                  <option value="pending">保留</option>
                  <option value="failed">失敗</option>
                  <option value="refunded">返金済</option>
                  <option value="canceled">取消</option>
                </select>
              </div>
              <div>
                <label className="label">支払方法</label>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="card">カード</option>
                  <option value="bank_transfer">銀行振込</option>
                </select>
              </div>
              <div>
                <label className="label">日時（寄付日）</label>
                <input type="date" className="input" value={donatedAt} onChange={(e) => setDonatedAt(e.target.value)} />
              </div>
              <div>
                <label className="label">入金確認日</label>
                <input type="date" className="input" value={confirmedAt} onChange={(e) => setConfirmedAt(e.target.value)} />
              </div>
              <div>
                <label className="label">寄付者名</label>
                <input className="input" value={donorName} onChange={(e) => setDonorName(e.target.value)} />
              </div>
              <div>
                <label className="label">寄付者メール</label>
                <input type="email" className="input" value={donorEmail} onChange={(e) => setDonorEmail(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">備考</label>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="sm:col-span-4">
                <label className="label">メッセージ</label>
                <textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
              <div className="sm:col-span-4 flex gap-2">
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
