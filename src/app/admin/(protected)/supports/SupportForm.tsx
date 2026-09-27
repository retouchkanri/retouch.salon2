"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Horse = { id: string; name: string };

export default function SupportForm({ horses }: { horses: Horse[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    customer_id: "",
    horse_id: horses[0]?.id ?? "",
    units: "1",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/supports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: form.customer_id,
        horse_id: form.horse_id,
        units: Number(form.units),
      }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "登録できませんでした。");
      return;
    }
    setMsg("登録しました。");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="grid md:grid-cols-4 gap-3">
      <div className="md:col-span-2">
        <label className="label">顧客ID または メールアドレス</label>
        <input
          className="input text-sm"
          required
          value={form.customer_id}
          onChange={set("customer_id")}
          placeholder="メールアドレス、または顧客ID（顧客詳細画面のURL）"
        />
      </div>
      <div>
        <label className="label">馬</label>
        <select className="input" value={form.horse_id} onChange={set("horse_id")} required>
          {horses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">口数（1口=12,000円/月・半口=0.5）</label>
        <input type="number" step="0.5" className="input" value={form.units} onChange={set("units")} min={0.5} />
      </div>
      {msg && <p className="md:col-span-4 text-sm">{msg}</p>}
      <div className="md:col-span-4">
        <button className="btn-primary" disabled={busy}>
          {busy ? "登録中..." : "支援を追加"}
        </button>
      </div>
    </form>
  );
}
