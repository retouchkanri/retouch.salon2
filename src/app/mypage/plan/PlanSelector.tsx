"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatYen } from "@/lib/format";

type PlanOption = {
  id: string;
  code: string;
  name: string;
  monthly_amount: number;
  description: string | null;
};

type Props = {
  plans: PlanOption[];
  currentPlanId: string | null;
  disabled: boolean;
};

function PlanSelector({ plans, currentPlanId, disabled }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (planId: string) => {
    setError(null);
    setSaving(planId);
    try {
      const res = await fetch("/api/mypage/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "変更に失敗しました");
        return;
      }
      if (j.checkout_url) {
        window.location.href = j.checkout_url;
        return;
      }
      router.replace("/mypage");
      router.refresh();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-danger text-sm">{error}</p>}
      <div className="grid gap-3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlanId;
          return (
            <div
              key={p.id}
              className={`p-4 rounded-xl border-2 ${
                isCurrent ? "border-brand bg-brand-50" : "border-surface-line bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">
                    {p.name}
                    {isCurrent && <span className="chip-ok ml-2">現在のプラン</span>}
                  </p>
                  <p className="text-2xl font-bold text-brand">
                    {formatYen(p.monthly_amount)}
                    <span className="text-sm text-ink-soft">/月</span>
                  </p>
                  {p.description && <p className="text-sm text-ink-soft mt-1">{p.description}</p>}
                </div>
                <button
                  type="button"
                  className={isCurrent ? "btn-ghost" : "btn-primary"}
                  disabled={disabled || saving !== null || isCurrent}
                  onClick={() => apply(p.id)}
                >
                  {saving === p.id ? "処理中..." : isCurrent ? "選択中" : "このプランに変更"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {disabled && (
        <p className="text-xs text-ink-mute">
          ※ 支援中の馬があるため、現在は会員種別（アテンダー／メンバーズ／サポーター／リェリーフ会員）への変更はできません。
        </p>
      )}
    </div>
  );
}

function CancelButton() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/mypage/plan", { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "停止に失敗しました");
        return;
      }
      router.replace("/mypage");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  if (!confirm) {
    return (
      <button className="btn-ghost text-danger" onClick={() => setConfirm(true)}>
        プランを停止する
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm">本当に停止しますか？</p>
      {error && <p className="text-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setConfirm(false)} disabled={saving}>
          戻る
        </button>
        <button className="btn-danger" onClick={run} disabled={saving}>
          {saving ? "停止中..." : "停止する"}
        </button>
      </div>
    </div>
  );
}

PlanSelector.Cancel = CancelButton;

export default PlanSelector;
