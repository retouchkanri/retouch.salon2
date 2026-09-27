"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PlanForm from "./PlanForm";

export default function PlanRow({ plan, displayYen, index }: { plan: any; displayYen: string; index: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm(`プラン「${plan.name}」を削除しますか？契約中の顧客がいる場合は自動で無効化されます。`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/plans/${plan.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "削除できませんでした。");
      return;
    }
    router.refresh();
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={10}>
          <div className="my-2">
            <PlanForm initial={plan} onSaved={() => setEditing(false)} />
            <button className="text-sm underline mt-2" onClick={() => setEditing(false)}>閉じる</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={plan.is_active ? "" : "opacity-60 bg-surface-soft"}>
      <td className="text-right text-ink-mute tabular-nums">{index}</td>
      <td className="font-mono text-xs">{plan.code}</td>
      <td className="font-semibold">
        {plan.name}
        {!plan.is_active && <span className="chip-mute ml-2">旧プラン</span>}
      </td>
      <td>{displayYen}</td>
      <td>{plan.unit_amount ?? "—"}</td>
      <td className="text-xs">
        {plan.allow_with_support ? "支✓" : "支✗"} / {plan.allow_with_team ? "チ✓" : "チ✗"}
      </td>
      <td className="font-mono text-[11px]">{plan.stripe_price_id ?? "—"}</td>
      <td>{plan.is_active ? <span className="chip-ok">有効</span> : <span className="chip-mute">無効</span>}</td>
      <td>{plan.sort_order}</td>
      <td className="text-right whitespace-nowrap">
        <button className="text-brand underline text-sm mr-3" onClick={() => setEditing(true)}>
          編集
        </button>
        <button className="text-danger underline text-sm" onClick={remove} disabled={busy}>
          {busy ? "..." : "削除"}
        </button>
      </td>
    </tr>
  );
}
