"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Horse = { id: string; name: string };
type Support = {
  id: string;
  horse_id: string;
  horse?: { name: string } | null;
  units: number;
  monthly_amount: number;
  status: string;
  started_at: string;
  canceled_at: string | null;
};

function unitAmountFrom(support: Support) {
  return support.units > 0 ? Math.round(support.monthly_amount / support.units) : 12000;
}

function formatYen(v: number) {
  return `¥${v.toLocaleString("ja-JP")}`;
}
function formatDate(v: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default function SupportsManager({
  customerId,
  supports,
  horses,
}: {
  customerId: string;
  supports: Support[];
  horses: Horse[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addHorse, setAddHorse] = useState<string>(horses[0]?.id ?? "");
  const [addUnits, setAddUnits] = useState<string>("1");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHorseId, setEditHorseId] = useState<string>("");
  const [editUnits, setEditUnits] = useState<string>("");

  const refresh = () => router.refresh();

  const createSupport = async () => {
    setErr(null);
    if (!addHorse) return;
    setBusyId("__add");
    const res = await fetch("/api/admin/supports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId,
        horse_id: addHorse,
        units: Number(addUnits),
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return setErr(j.error ?? "追加に失敗しました");
    setAddOpen(false);
    setAddUnits("1");
    refresh();
  };

  const startEdit = (s: Support) => {
    setEditingId(s.id);
    setEditHorseId(s.horse_id);
    setEditUnits(String(s.units));
    setErr(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusyId(editingId);
    setErr(null);
    const original = supports.find((s) => s.id === editingId);
    const body: Record<string, any> = {
      units: Number(editUnits),
    };
    if (editHorseId && editHorseId !== original?.horse_id) {
      body.horse_id = editHorseId;
    }
    const res = await fetch(`/api/admin/supports/${editingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return setErr(j.error ?? "更新に失敗しました");
    setEditingId(null);
    refresh();
  };

  const cancelSupport = async (id: string) => {
    if (!confirm("この支援を停止します。よろしいですか？")) return;
    setBusyId(id);
    setErr(null);
    const res = await fetch(`/api/admin/supports/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "停止に失敗しました");
    }
    refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-mute">{supports.length}件</p>
        {!addOpen ? (
          <button className="btn-primary !py-1.5 !px-3 text-sm" onClick={() => setAddOpen(true)}>
            ＋ 支援を追加
          </button>
        ) : (
          <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setAddOpen(false)}>
            キャンセル
          </button>
        )}
      </div>

      {addOpen && (
        <div className="grid md:grid-cols-3 gap-2 p-3 bg-surface-soft rounded-xl border border-surface-line">
          <div>
            <label className="label">馬</label>
            <select className="input" value={addHorse} onChange={(e) => setAddHorse(e.target.value)}>
              {horses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">口数（1口=12,000円/月・半口=0.5）</label>
            <input
              className="input"
              type="number"
              step="0.5"
              min="0.5"
              value={addUnits}
              onChange={(e) => setAddUnits(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={createSupport} disabled={busyId === "__add"}>
              {busyId === "__add" ? "登録中..." : "追加する"}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-danger text-sm">{err}</p>}

      <table className="table">
        <thead>
          <tr>
            <th className="w-12 text-right">No.</th>
            <th>馬</th>
            <th>口数</th>
            <th>単価</th>
            <th>月額</th>
            <th>状態</th>
            <th>開始</th>
            <th>停止</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {supports.map((s, i) => {
            const editing = editingId === s.id;
            return (
              <tr key={s.id}>
                <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                <td>
                  {editing ? (
                    <select
                      className="input !py-1"
                      value={editHorseId}
                      onChange={(e) => setEditHorseId(e.target.value)}
                    >
                      {horses.map((h) => (
                        <option key={h.id} value={h.id}>{h.name}</option>
                      ))}
                    </select>
                  ) : (
                    s.horse?.name ?? "—"
                  )}
                </td>
                <td>
                  {editing ? (
                    <input
                      className="input !py-1"
                      type="number"
                      step="0.5"
                      value={editUnits}
                      onChange={(e) => setEditUnits(e.target.value)}
                    />
                  ) : (
                    `${s.units}口`
                  )}
                </td>
                <td>{formatYen(unitAmountFrom(s))}</td>
                <td>{formatYen(s.monthly_amount)}</td>
                <td>{s.status}</td>
                <td>{formatDate(s.started_at)}</td>
                <td>{s.canceled_at ? formatDate(s.canceled_at) : "—"}</td>
                <td className="text-right">
                  {editing ? (
                    <div className="flex gap-1 justify-end">
                      <button
                        className="btn-primary !py-1 !px-2 text-xs"
                        onClick={saveEdit}
                        disabled={busyId === s.id}
                      >
                        保存
                      </button>
                      <button
                        className="btn-ghost !py-1 !px-2 text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1 justify-end">
                      <button
                        className="btn-secondary !py-1 !px-2 text-xs"
                        onClick={() => startEdit(s)}
                      >
                        変更
                      </button>
                      {s.status !== "canceled" && (
                        <button
                          className="btn-danger !py-1 !px-2 text-xs"
                          onClick={() => cancelSupport(s.id)}
                          disabled={busyId === s.id}
                        >
                          停止
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {supports.length === 0 && (
            <tr>
              <td colSpan={9} className="text-center text-ink-mute py-3">
                支援履歴はまだありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
