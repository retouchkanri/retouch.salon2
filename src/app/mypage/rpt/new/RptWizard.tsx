"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatYen } from "@/lib/format";

const MONTHLY = 3000;

export default function RptWizard() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/mypage/rpt", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(j.error ?? "登録できませんでした。");
      return;
    }
    if (j.checkout_url) {
      window.location.href = j.checkout_url;
      return;
    }
    router.replace("/mypage");
    router.refresh();
  };

  return (
    <div className="card space-y-4">
      <ol className="flex items-center gap-2 text-sm">
        {[1, 2].map((n) => (
          <li
            key={n}
            className={`flex-1 py-2 text-center rounded-lg font-semibold
              ${n === step ? "bg-brand text-white" : n < step ? "bg-brand-50 text-brand" : "bg-surface-soft text-ink-mute"}`}
          >
            STEP {n}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div>
          <h2 className="section-title">リタポ会員について</h2>
          <div className="space-y-3 text-sm text-ink-soft">
            <p>
              RetouchPony Team（リタポ）は、Retouch馬の活動を月額でご支援いただける会員制度です。
            </p>
            <dl className="divide-y divide-surface-line">
              <div className="py-3 flex justify-between">
                <dt className="text-ink-soft">月額</dt>
                <dd className="font-bold text-brand">{formatYen(MONTHLY)} / 月</dd>
              </div>
              <div className="py-3 flex justify-between">
                <dt className="text-ink-soft">他会員との併用</dt>
                <dd className="font-bold">可能（すべての会員種別と併用いただけます）</dd>
              </div>
              <div className="py-3 flex justify-between">
                <dt className="text-ink-soft">いつでも停止</dt>
                <dd className="font-bold">可能</dd>
              </div>
            </dl>
          </div>
          <div className="flex justify-between mt-4">
            <span />
            <button className="btn-primary" onClick={() => setStep(2)}>
              内容確認へ進む
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="section-title">内容確認</h2>
          <dl className="divide-y divide-surface-line mb-4">
            <div className="py-3 flex justify-between">
              <dt className="text-ink-soft">会員種別</dt>
              <dd className="font-bold">RetouchPony【リタポ】メンバー</dd>
            </div>
            <div className="py-3 flex justify-between">
              <dt className="text-ink-soft">月額</dt>
              <dd className="font-bold text-brand">{formatYen(MONTHLY)} / 月</dd>
            </div>
          </dl>
          <p className="text-xs text-ink-soft mb-3">
            他の会員種別（メンバーズ・サポーター・ヘルパーズ等）と併用いただけます。いつでも停止が可能です。
          </p>
          {error && <p className="text-danger text-sm mb-2">{error}</p>}
          <div className="flex justify-between">
            <button className="btn-ghost" onClick={() => setStep(1)}>戻る</button>
            <button className="btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? "処理中..." : "この内容で申し込む"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
