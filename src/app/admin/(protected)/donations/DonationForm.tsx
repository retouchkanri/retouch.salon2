"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DonationForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    customer_id: "",
    donor_name: "",
    donor_email: "",
    amount: "3000",
    message: "",
    // 既定は「保留」。銀行振込は入金確認(入金確認日の入力)までは保留とする。
    status: "pending" as "succeeded" | "pending" | "failed" | "refunded",
    payment_method: "bank_transfer" as "card" | "bank_transfer",
    confirmed_at: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value as any }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload: Record<string, unknown> = {
      amount: Number(form.amount),
      status: form.status,
      message: form.message || null,
      donor_name: form.donor_name || null,
      payment_method: form.payment_method,
      confirmed_at: form.confirmed_at || null,
      note: form.note || null,
    };
    if (form.customer_id) payload.customer_id = form.customer_id;
    if (form.donor_email) payload.donor_email = form.donor_email;
    const res = await fetch("/api/admin/donations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "登録できませんでした。");
      return;
    }
    setMsg("登録しました。");
    setForm({
      customer_id: "",
      donor_name: "",
      donor_email: "",
      amount: "3000",
      message: "",
      status: "pending",
      payment_method: "bank_transfer",
      confirmed_at: "",
      note: "",
    });
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="grid md:grid-cols-4 gap-3">
      <div>
        <label className="label">顧客ID（任意）</label>
        <input className="input font-mono text-xs" value={form.customer_id} onChange={set("customer_id")} placeholder="UUID" />
      </div>
      <div>
        <label className="label">寄付者名</label>
        <input className="input" value={form.donor_name} onChange={set("donor_name")} />
      </div>
      <div>
        <label className="label">寄付者メール</label>
        <input type="email" className="input" value={form.donor_email} onChange={set("donor_email")} />
      </div>
      <div>
        <label className="label">金額（円）</label>
        <input type="number" className="input" value={form.amount} onChange={set("amount")} min={100} />
      </div>
      <div>
        <label className="label">状態</label>
        <select className="input" value={form.status} onChange={set("status")}>
          <option value="succeeded">成功</option>
          <option value="pending">保留</option>
          <option value="failed">失敗</option>
          <option value="refunded">返金済</option>
        </select>
      </div>
      <div>
        <label className="label">支払方法</label>
        <select className="input" value={form.payment_method} onChange={set("payment_method")}>
          <option value="bank_transfer">銀行振込</option>
          <option value="card">カード</option>
        </select>
      </div>
      <div>
        <label className="label">入金確認日</label>
        <input type="date" className="input" value={form.confirmed_at} onChange={set("confirmed_at")} />
      </div>
      <div className="md:col-span-2">
        <label className="label">備考</label>
        <input className="input" value={form.note} onChange={set("note")} placeholder="振込名義・確認メモなど" />
      </div>
      <div className="md:col-span-4">
        <label className="label">メッセージ</label>
        <input className="input" value={form.message} onChange={set("message")} />
      </div>
      {msg && <p className="md:col-span-4 text-sm">{msg}</p>}
      <div className="md:col-span-4">
        <button className="btn-primary" disabled={busy}>
          {busy ? "登録中..." : "寄付を追加"}
        </button>
      </div>
    </form>
  );
}
