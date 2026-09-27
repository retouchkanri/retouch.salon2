"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatYen } from "@/lib/format";

const PRESETS = [3000, 5000, 10000, 30000, 50000];
const DEFAULT_AMOUNT = 10000;

type PayMethod = "card" | "bank_transfer";

export default function PublicDonationForm() {
  const router = useRouter();
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [method, setMethod] = useState<PayMethod>("card");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!amount || amount < 100) {
      setError("金額は100円以上で指定してください。");
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("お礼メール送付のため、メールアドレスをご入力ください。");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/donations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount,
          message: message || null,
          donor_name: name || null,
          donor_email: email || null,
          payment_method: method,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "処理できませんでした。");
        return;
      }
      // 銀行振込：振込先案内ページへ。
      if (j.bank_transfer) {
        router.push(`/donate/thanks?method=bank&amount=${amount}`);
        router.refresh();
        return;
      }
      // カード：Stripe 決済ページへ。
      if (j.checkout_url) {
        window.location.href = j.checkout_url;
        return;
      }
      router.push("/donate/thanks");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div>
        <label className="label">寄付金額</label>
        <p className="text-xs text-ink-mute mb-2">金額を入力するか、下のボタンから選択できます。</p>
        <div className="relative mb-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-ink-mute">¥</span>
          <input
            type="number"
            min={100}
            step={100}
            className="input text-lg font-bold text-right pl-8"
            value={amount}
            placeholder="例：7000"
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>
        <p className="text-xs text-ink-mute mb-3">100円以上のお好きな金額をご入力ください。</p>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 border-t border-surface-line" />
          <span className="text-xs text-ink-mute whitespace-nowrap">またはよく使われる金額から選ぶ</span>
          <div className="flex-1 border-t border-surface-line" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setAmount(p)}
              className={`py-3 rounded-xl border-2 font-bold ${
                amount === p ? "bg-brand text-white border-brand" : "bg-white border-surface-line text-ink"
              }`}
            >
              {formatYen(p)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">お名前（任意）</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="label">
          メールアドレス <span className="text-danger">（必須：お礼メール送付先）</span>
        </label>
        <input
          type="email"
          required
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="example@example.com"
        />
        <p className="text-xs text-ink-mute mt-1">
          寄付確認メールをお送りするため、メールアドレスの入力をお願いしております。
        </p>
      </div>

      <div>
        <label className="label">応援メッセージ（任意）</label>
        <textarea
          className="input"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <div>
        <label className="label">お支払い方法</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMethod("card")}
            className={`py-3 rounded-xl border-2 font-bold ${
              method === "card" ? "bg-brand text-white border-brand" : "bg-white border-surface-line text-ink"
            }`}
          >
            クレジットカード
          </button>
          <button
            type="button"
            onClick={() => setMethod("bank_transfer")}
            className={`py-3 rounded-xl border-2 font-bold ${
              method === "bank_transfer" ? "bg-brand text-white border-brand" : "bg-white border-surface-line text-ink"
            }`}
          >
            銀行振込
          </button>
        </div>
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}

      <button className="btn-accent w-full" disabled={saving}>
        {saving ? "処理中..." : method === "bank_transfer" ? "この内容で申し込む（銀行振込）" : "この内容で寄付する"}
      </button>
      <p className="text-xs text-ink-mute">
        {method === "bank_transfer"
          ? "お申し込み後、振込先口座をご案内します（確認メールもお送りします）。入金確認後に受付完了となります。"
          : "Stripe の決済ページへ移動します。カード情報は当サイトでは保存されません。"}
      </p>
    </form>
  );
}
