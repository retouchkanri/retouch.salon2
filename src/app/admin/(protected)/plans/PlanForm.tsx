"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Initial = {
  id?: string;
  code?: "A" | "B" | "C" | "SPECIAL_TEAM" | "SUPPORT" | "RPT";
  name?: string;
  monthly_amount?: number;
  unit_amount?: number | null;
  stripe_price_id?: string | null;
  description?: string | null;
  allow_with_support?: boolean;
  allow_with_team?: boolean;
  is_active?: boolean;
  sort_order?: number;
};

export default function PlanForm({
  initial,
  onSaved,
}: {
  initial?: Initial;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState({
    code: (initial?.code ?? "A") as Initial["code"],
    name: initial?.name ?? "",
    monthly_amount: initial?.monthly_amount ?? 1000,
    unit_amount: initial?.unit_amount ?? "",
    stripe_price_id: initial?.stripe_price_id ?? "",
    description: initial?.description ?? "",
    allow_with_support: initial?.allow_with_support ?? false,
    allow_with_team: initial?.allow_with_team ?? true,
    is_active: initial?.is_active ?? true,
    sort_order: initial?.sort_order ?? 100,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const t: any = e.target;
      setForm((p) => ({ ...p, [k]: t.type === "checkbox" ? t.checked : t.value }));
    };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = {
      ...form,
      monthly_amount: Number(form.monthly_amount),
      unit_amount: form.unit_amount === "" ? null : Number(form.unit_amount),
      sort_order: Number(form.sort_order),
      stripe_price_id: form.stripe_price_id || null,
      description: form.description || null,
    };
    const url = editing ? `/api/admin/plans/${initial!.id}` : "/api/admin/plans";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "保存できませんでした。");
      return;
    }
    setMsg(editing ? "保存しました。" : "登録しました。");
    if (!editing) {
      setForm({
        code: "A",
        name: "",
        monthly_amount: 1000,
        unit_amount: "",
        stripe_price_id: "",
        description: "",
        allow_with_support: false,
        allow_with_team: true,
        is_active: true,
        sort_order: 100,
      });
    }
    onSaved?.();
    router.refresh();
  };

  return (
    <form onSubmit={save} className="grid md:grid-cols-6 gap-3">
      <div>
        <label className="label">コード</label>
        <select className="input" value={form.code} onChange={set("code")}>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="SPECIAL_TEAM">SPECIAL_TEAM</option>
          <option value="SUPPORT">SUPPORT</option>
          <option value="RPT">RPT</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="label">名称</label>
        <input className="input" value={form.name} onChange={set("name")} required />
      </div>
      <div>
        <label className="label">月額（円）</label>
        <input type="number" className="input" value={form.monthly_amount} onChange={set("monthly_amount")} min={0} />
      </div>
      <div>
        <label className="label">単価（円/口）</label>
        <input type="number" className="input" value={form.unit_amount as any} onChange={set("unit_amount")} min={0} placeholder="支援プランのみ" />
      </div>
      <div>
        <label className="label">並び順</label>
        <input type="number" className="input" value={form.sort_order} onChange={set("sort_order")} />
      </div>
      <div className="md:col-span-3">
        <label className="label">Stripe Price ID</label>
        <input className="input font-mono text-xs" value={form.stripe_price_id} onChange={set("stripe_price_id")} placeholder="price_..." />
      </div>
      <div className="md:col-span-3">
        <label className="label">説明</label>
        <input className="input" value={form.description} onChange={set("description")} />
      </div>
      <label className="flex items-center gap-2 md:col-span-2">
        <input type="checkbox" checked={form.allow_with_support} onChange={set("allow_with_support")} className="w-5 h-5" />
        <span className="text-sm">支援会員と併用可</span>
      </label>
      <label className="flex items-center gap-2 md:col-span-2">
        <input type="checkbox" checked={form.allow_with_team} onChange={set("allow_with_team")} className="w-5 h-5" />
        <span className="text-sm">特別チームと併用可</span>
      </label>
      <label className="flex items-center gap-2 md:col-span-2">
        <input type="checkbox" checked={form.is_active} onChange={set("is_active")} className="w-5 h-5" />
        <span className="text-sm">有効（会員が選択可能）</span>
      </label>
      {msg && <p className="text-sm md:col-span-6">{msg}</p>}
      <div className="md:col-span-6 flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? "保存中..." : editing ? "変更を保存" : "プランを登録"}
        </button>
      </div>
    </form>
  );
}
