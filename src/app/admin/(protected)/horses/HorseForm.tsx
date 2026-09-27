"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HorseForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    name_kana: "",
    sex: "",
    birth_year: "",
    profile: "",
    is_supportable: true,
    is_emergency_recruitment: false,
    sort_order: 100,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string) => (e: any) =>
    setForm((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = {
      ...form,
      birth_year: form.birth_year ? Number(form.birth_year) : null,
      sort_order: Number(form.sort_order),
    };
    const res = await fetch("/api/admin/horses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? "登録できませんでした。");
      return;
    }
    setForm({ name: "", name_kana: "", sex: "", birth_year: "", profile: "", is_supportable: true, is_emergency_recruitment: false, sort_order: 100 });
    setMsg("登録しました。");
    router.refresh();
  };

  return (
    <form onSubmit={save} className="card grid md:grid-cols-4 gap-3">
      <div className="md:col-span-2"><label className="label">名前</label><input required className="input" value={form.name} onChange={set("name")} /></div>
      <div><label className="label">カナ</label><input className="input" value={form.name_kana} onChange={set("name_kana")} /></div>
      <div><label className="label">性別</label><input className="input" value={form.sex} onChange={set("sex")} placeholder="牡/牝など" /></div>
      <div><label className="label">生年</label><input type="number" className="input" value={form.birth_year} onChange={set("birth_year")} /></div>
      <div className="md:col-span-2"><label className="label">紹介文</label><input className="input" value={form.profile} onChange={set("profile")} /></div>
      <div><label className="label">並び順</label><input type="number" className="input" value={form.sort_order} onChange={set("sort_order")} /></div>
      <label className="flex items-center gap-2 md:col-span-2">
        <input type="checkbox" checked={form.is_supportable} onChange={set("is_supportable")} className="w-5 h-5" />
        <span>支援受付中</span>
      </label>
      <label className="flex items-center gap-2 md:col-span-2">
        <input
          type="checkbox"
          checked={form.is_emergency_recruitment}
          onChange={set("is_emergency_recruitment")}
          className="w-5 h-5"
        />
        <span>緊急支援募集（トップ・馬一覧でピンク表示・最上段に固定）</span>
      </label>
      {msg && <p className="text-sm md:col-span-4">{msg}</p>}
      <div className="md:col-span-4">
        <button className="btn-primary" disabled={busy}>{busy ? "登録中..." : "馬を登録"}</button>
      </div>
    </form>
  );
}
