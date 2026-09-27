"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatYen, statusLabel } from "@/lib/format";

type Plan = { id: string; code: string; name: string; monthly_amount: number };
type Contract = {
  id: string;
  plan: Plan | null;
  status: string;
  started_at: string;
  canceled_at: string | null;
};

export default function BasicPlanManager({
  customerId,
  contracts,
  plans,
  attenderPlanId = null,
}: {
  customerId: string;
  contracts: Contract[];
  plans: Plan[];
  /** 「アテンダー会員にする」ワンクリックボタン用の無償アテンダープランID */
  attenderPlanId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id ?? "");

  const hasActive = contracts.some((c) => c.status === "active" || c.status === "past_due");
  const refresh = () => router.refresh();

  const createContract = async (planId: string, busyKey: string) => {
    setErr(null);
    if (!planId) return setErr("プランを選択してください");
    setBusy(busyKey);
    const res = await fetch("/api/admin/contracts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_id: customerId, plan_id: planId, status: "active" }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.error ?? "登録に失敗しました");
    setAddOpen(false);
    refresh();
  };

  const addContract = () => createContract(selectedPlanId, "__add");

  const makeAttender = async () => {
    if (!attenderPlanId) return;
    if (!confirm("この会員を「アテンダー会員（無料）」にします。よろしいですか？\n（Stripe決済は発生しません）")) return;
    await createContract(attenderPlanId, "__attender");
  };

  const cancelContract = async (id: string) => {
    if (!confirm("この会員を停止します。よろしいですか？\n（Stripe側の解約は別途必要です）")) return;
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/admin/contracts/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "停止に失敗しました");
    }
    refresh();
  };

  return (
    <div className="space-y-2">
      {err && <p className="text-danger text-sm">{err}</p>}
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">基本会員（アテンダー / メンバーズ / サポーター / リェリーフ / オーナーズ）</h3>
        <div className="flex items-center gap-2">
          {attenderPlanId && !addOpen && (
            <button
              className="btn-secondary !py-1.5 !px-3 text-sm whitespace-nowrap"
              onClick={makeAttender}
              disabled={hasActive || busy === "__attender"}
              title={hasActive ? "既にアクティブな会員種別があります" : "高額寄付者への感謝として無料でアテンダー会員に変更します"}
            >
              {busy === "__attender" ? "変更中..." : "アテンダー会員にする（無料）"}
            </button>
          )}
          {!addOpen ? (
            <button
              className="btn-primary !py-1.5 !px-3 text-sm"
              onClick={() => setAddOpen(true)}
              disabled={hasActive}
              title={hasActive ? "既にアクティブな会員種別があります" : undefined}
            >
              ＋ 会員を追加
            </button>
          ) : (
            <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setAddOpen(false)}>
              キャンセル
            </button>
          )}
        </div>
      </div>

      {addOpen && (
        <div className="grid md:grid-cols-2 gap-2 p-3 bg-surface-soft rounded-xl border border-surface-line">
          <div>
            <label className="label">会員種別</label>
            <select className="input" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{formatYen(p.monthly_amount)}/月）
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              className="btn-primary w-full"
              onClick={addContract}
              disabled={busy === "__add"}
            >
              {busy === "__add" ? "登録中..." : "追加する"}
            </button>
          </div>
          <p className="md:col-span-2 text-xs text-ink-soft">
            Stripe決済を発生させずに記録として登録します。オーナーズ会員は無料（¥0）です。既にStripe等で課金中の会員の手動登録にご利用ください。
          </p>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th className="w-12 text-right">No.</th>
            <th>プラン</th>
            <th>月額</th>
            <th>状態</th>
            <th>開始</th>
            <th>停止</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((x, i) => (
            <tr key={x.id}>
              <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
              <td>{x.plan?.name ?? "—"}</td>
              <td>{formatYen(x.plan?.monthly_amount ?? 0)}</td>
              <td>{statusLabel(x.status)}</td>
              <td>{formatDate(x.started_at)}</td>
              <td>{x.canceled_at ? formatDate(x.canceled_at) : "—"}</td>
              <td className="text-right">
                {x.status !== "canceled" && (
                  <button
                    className="btn-danger !py-1 !px-2 text-xs"
                    onClick={() => cancelContract(x.id)}
                    disabled={busy === x.id}
                  >
                    停止
                  </button>
                )}
              </td>
            </tr>
          ))}
          {contracts.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-ink-mute py-3">
                基本会員の登録はありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
