"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import horseImage from "@/assets/images/horse.png";
import type { Horse, MembershipPlan } from "@/types/db";
import { SUPPORT_UNIT_PRICE } from "@/lib/constraints";
import { formatYen } from "@/lib/format";
import { isEmergencyRecruitmentHorse } from "@/lib/horses";
import EmergencyHorseImage from "@/components/EmergencyHorseImage";

type Props = {
  horses: Horse[];
  plan: MembershipPlan | null;
  existingHorseIds: string[];
  conflictingContractId: string | null;
  conflictingPlanName: string | null;
  initialHorseId?: string | null;
};

export default function NewSupportWizard({ horses, plan, existingHorseIds, conflictingContractId, conflictingPlanName, initialHorseId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [horseId, setHorseId] = useState<string | null>(
    initialHorseId && horses.some((h) => h.id === initialHorseId) ? initialHorseId : null
  );
  const [units, setUnits] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelAgreed, setCancelAgreed] = useState(false);

  const selectedHorse = horses.find((h) => h.id === horseId) ?? null;
  // Support is always priced at SUPPORT_UNIT_PRICE per 口; a half share is units 0.5.
  const monthly = useMemo(() => Math.round(SUPPORT_UNIT_PRICE * units), [units]);

  const submit = async () => {
    if (!horseId || !plan || units <= 0) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/mypage/supports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        horse_id: horseId,
        plan_id: plan.id,
        units,
        ...(conflictingContractId ? { cancel_contract_id: conflictingContractId } : {}),
      }),
    });
    const j = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(j.error ?? "登録できませんでした。");
      return;
    }
    if (j.checkout_url) {
      window.location.href = j.checkout_url;
      return;
    }
    router.replace("/mypage/supports/completed");
    router.refresh();
  };

  return (
    <div className="card space-y-4">
      <ol className="flex items-center gap-2 text-sm">
        {[1, 2, 3].map((n) => (
          <li key={n} className={`flex-1 py-2 text-center rounded-lg font-semibold
            ${n === step ? "bg-brand text-white" : n < step ? "bg-brand-50 text-brand" : "bg-surface-soft text-ink-mute"}`}>
            STEP {n}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div>
          <h2 className="section-title">支援する馬を選ぶ</h2>
          <div className="grid gap-2 max-h-[55vh] overflow-auto">
            {horses.map((h) => {
              const owned = existingHorseIds.includes(h.id);
              const emergency = isEmergencyRecruitmentHorse(h);
              return (
                <label
                  key={h.id}
                  className={`border-2 rounded-xl p-3 flex items-center gap-3 cursor-pointer
                    ${horseId === h.id
                      ? emergency
                        ? "border-pink-500 bg-pink-50"
                        : "border-brand bg-brand-50"
                      : emergency
                        ? "border-pink-300 bg-pink-50/40"
                        : "border-surface-line"}`}
                >
                  <input
                    type="radio"
                    className="w-5 h-5 shrink-0"
                    name="horse"
                    checked={horseId === h.id}
                    onChange={() => setHorseId(h.id)}
                  />
                  {emergency ? (
                    <EmergencyHorseImage name={h.name} />
                  ) : h.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.image_url} alt={h.name} className="w-14 h-14 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-brand-50 overflow-hidden shrink-0">
                      <Image src={horseImage} alt="horse" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`font-bold ${emergency ? "text-pink-700" : ""}`}>
                      {h.name}
                      {emergency && (
                        <span className="chip ml-2 !bg-pink-100 !text-pink-800 !border-pink-200 text-xs">
                          支援募集開始
                        </span>
                      )}
                      {owned && <span className="chip-warn ml-2">支援中（口数を追加）</span>}
                    </p>
                    <p className={`text-xs line-clamp-2 ${emergency ? "text-pink-600 font-medium" : "text-ink-soft"}`}>
                      {h.profile ?? ""}
                    </p>
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
          <h2 className="section-title">口数を選ぶ</h2>
          <div className="border-2 border-surface-line rounded-xl p-3 mb-4">
            <p className="font-bold">{plan?.name ?? "支援会員"}</p>
            <p className="text-sm text-ink-soft">1口 {formatYen(SUPPORT_UNIT_PRICE)} / 月（半口＝0.5口）</p>
          </div>
          <div>
            <label className="label">口数</label>
            <div className="flex items-center gap-3">
              <button type="button" className="btn-secondary !py-2 !px-4" onClick={() => setUnits((u) => Math.max(0.5, Math.round((u - 0.5) * 2) / 2))}>−</button>
              <input
                type="number" min={0.5} step={0.5}
                className="input text-center text-xl font-bold w-28"
                value={units}
                onChange={(e) => setUnits(Number(e.target.value))}
              />
              <button type="button" className="btn-secondary !py-2 !px-4" onClick={() => setUnits((u) => Math.round((u + 0.5) * 2) / 2)}>＋</button>
            </div>
            <p className="mt-3 text-ink-soft">月額見込み：<span className="text-xl font-bold text-brand">{formatYen(monthly)}</span></p>
          </div>
          <div className="flex justify-between mt-4">
            <button className="btn-ghost" onClick={() => setStep(1)}>戻る</button>
            <button className="btn-primary" disabled={!plan || units <= 0} onClick={() => setStep(3)}>内容を確認する</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 className="section-title">内容確認</h2>
          <dl className="divide-y divide-surface-line mb-4">
            <div className="py-3 flex justify-between"><dt className="text-ink-soft">支援する馬</dt><dd className="font-bold">{selectedHorse?.name}</dd></div>
            <div className="py-3 flex justify-between"><dt className="text-ink-soft">支援内容</dt><dd className="font-bold">{plan?.name ?? "支援会員"}</dd></div>
            <div className="py-3 flex justify-between"><dt className="text-ink-soft">口数</dt><dd className="font-bold">{units} 口</dd></div>
            <div className="py-3 flex justify-between"><dt className="text-ink-soft">月額見込み</dt><dd className="font-bold text-brand">{formatYen(monthly)}</dd></div>
          </dl>
          {conflictingContractId && conflictingPlanName && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 mb-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 shrink-0"
                  checked={cancelAgreed}
                  onChange={(e) => setCancelAgreed(e.target.checked)}
                />
                <span className="text-sm text-amber-800">
                  現在ご加入の<strong>{conflictingPlanName}</strong>を自動解約し、ヘルパーズ会員（一口支援）へ切り替えることに同意します。
                </span>
              </label>
            </div>
          )}
          {error && <p className="text-danger text-sm mb-2">{error}</p>}
          <div className="flex justify-between">
            <button className="btn-ghost" onClick={() => setStep(2)}>戻る</button>
            <button
              className="btn-primary"
              onClick={submit}
              disabled={submitting || (!!conflictingContractId && !cancelAgreed)}
            >
              {submitting ? "処理中..." : "この内容で申し込む"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
