"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatYen } from "@/lib/format";

const PRESETS = [3000, 5000, 10000, 30000, 50000];

export default function DonationForm() {
  const router = useRouter();
  const [amount, setAmount] = useState(10000);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!amount || amount < 100) {
      setError("金額は100円以上で指定してください");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/mypage/donations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, message }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(j.error ?? "処理できませんでした。");
      return;
    }
    if (j.checkout_url) {
      window.location.href = j.checkout_url;
      return;
    }
    router.replace("/mypage/donate/thanks");
    router.refresh();
  };

  return (
    <div className="card space-y-4">
      <div>
        <label className="label">寄付金額</label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(p)}
              className={`py-3 rounded-xl border-2 font-bold
                ${amount === p ? "bg-brand text-white border-brand" : "bg-white border-surface-line text-ink"}`}
            >
              {formatYen(p)}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={100}
          step={100}
          className="input text-lg font-bold text-right"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </div>
      <div>
        <label className="label">応援メッセージ（任意）</label>
        <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
      <button className="btn-accent w-full" onClick={submit} disabled={saving}>
        {saving ? "処理中..." : "この内容で寄付する"}
      </button>
      <p className="text-xs text-ink-mute">
        Stripe の決済ページへ移動します。決済完了後、自動でお礼メールをお送りいたします。
      </p>
    </div>
  );
}
