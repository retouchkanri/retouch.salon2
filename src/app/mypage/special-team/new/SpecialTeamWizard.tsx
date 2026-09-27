"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import horseImage from "@/assets/images/horse.png";
import type { Horse } from "@/types/db";
import { formatYen } from "@/lib/format";

type Props = {
  horses: Horse[];
  monthly: number;
  joinedHorseIds: string[];
};

export default function SpecialTeamWizard({ horses, monthly, joinedHorseIds }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [horseId, setHorseId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedHorse = horses.find((h) => h.id === horseId) ?? null;

  const submit = async () => {
    if (!horseId) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/mypage/special-team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ horse_id: horseId }),
    });
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
          <h2 className="section-title">応援する馬を選ぶ</h2>
          <div className="grid gap-2 max-h-[55vh] overflow-auto">
            {horses.map((h) => {
              const owned = joinedHorseIds.includes(h.id);
              return (
                <label
                  key={h.id}
                  className={`border-2 rounded-xl p-3 flex items-center gap-3 cursor-pointer
                    ${horseId === h.id ? "border-brand bg-brand-50" : "border-surface-line"}
                    ${owned ? "opacity-50" : ""}`}
                >
                  <input
                    type="radio"
                    className="w-5 h-5 shrink-0"
                    name="horse"
                    checked={horseId === h.id}
                    onChange={() => setHorseId(h.id)}
                    disabled={owned}
                  />
                  {h.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.image_url} alt={h.name} className="w-14 h-14 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-brand-50 overflow-hidden shrink-0">
                      <Image src={horseImage} alt="horse" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold">
                      {h.name}
                      {owned && <span className="chip-mute ml-2">加入済み</span>}
                    </p>
                    <p className="text-xs text-ink-soft line-clamp-2">{h.profile ?? ""}</p>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex justify-between mt-4">
            <span />
            <button className="btn-primary" disabled={!horseId} onClick={() => setStep(2)}>
              次へ進む
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
              <dd className="font-bold">特別チーム会員</dd>
            </div>
            <div className="py-3 flex justify-between">
              <dt className="text-ink-soft">応援する馬</dt>
              <dd className="font-bold">{selectedHorse?.name}</dd>
            </div>
            <div className="py-3 flex justify-between">
              <dt className="text-ink-soft">月額</dt>
              <dd className="font-bold text-brand">{formatYen(monthly)}</dd>
            </div>
          </dl>
          <p className="text-xs text-ink-soft mb-3">
            特別チーム会員は、他の会員種別（A/B/C会員・支援会員）と併用いただけます。いつでも停止が可能です。
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
