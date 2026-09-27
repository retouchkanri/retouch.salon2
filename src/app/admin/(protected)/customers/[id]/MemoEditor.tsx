"use client";
import { useState } from "react";

type Memo = { slot: number; body: string };

export default function MemoEditor({
  customerId,
  initial,
}: {
  customerId: string;
  initial: Memo[];
}) {
  const start: Record<number, string> = { 1: "", 2: "", 3: "" };
  for (const m of initial) start[m.slot] = m.body ?? "";
  const [state, setState] = useState(start);
  const [saving, setSaving] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (slot: number) => {
    setSaving(slot);
    setMsg(null);
    const res = await fetch(`/api/admin/customers/${customerId}/memos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot, body: state[slot] ?? "" }),
    });
    setSaving(null);
    setMsg(res.ok ? `メモ${slot}を保存しました。` : "保存に失敗しました。");
  };

  return (
    <div className="space-y-4">
      {[1, 2, 3].map((slot) => (
        <div key={slot}>
          <label className="label">メモ{slot}</label>
          <textarea
            className="input"
            rows={3}
            value={state[slot] ?? ""}
            onChange={(e) => setState((prev) => ({ ...prev, [slot]: e.target.value }))}
          />
          <div className="mt-1 flex justify-end">
            <button className="btn-secondary !py-1.5 !px-3 text-sm" onClick={() => save(slot)} disabled={saving === slot}>
              {saving === slot ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      ))}
      {msg && <p className="text-sm text-ok">{msg}</p>}
    </div>
  );
}
