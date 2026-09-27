"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Horse } from "@/types/db";

export default function HorseEditForm({ horse }: { horse: Horse }) {
  const router = useRouter();
  const [form, setForm] = useState<any>({
    name: horse.name ?? "",
    name_kana: horse.name_kana ?? "",
    sex: horse.sex ?? "",
    birth_year: horse.birth_year ?? "",
    profile: horse.profile ?? "",
    image_url: horse.image_url ?? "",
    is_supportable: horse.is_supportable,
    is_emergency_recruitment: horse.is_emergency_recruitment ?? false,
    sort_order: horse.sort_order ?? 100,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const set = (k: string) => (e: any) =>
    setForm((p: any) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const remove = async () => {
    setDeleting(true);
    setDelErr(null);
    const res = await fetch(`/api/admin/horses/${horse.id}`, { method: "DELETE" });
    if (res.ok) {
      router.replace("/admin/horses");
      router.refresh();
      return;
    }
    const j = await res.json().catch(() => ({}));
    setDelErr(j.error ?? "削除に失敗しました。");
    setDeleting(false);
    setConfirmDelete(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = {
      ...form,
      birth_year: form.birth_year ? Number(form.birth_year) : null,
      sort_order: Number(form.sort_order),
    };
    const res = await fetch(`/api/admin/horses/${horse.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    setMsg(res.ok ? "保存しました。" : "保存に失敗しました。");
    router.refresh();
  };

  return (
    <form onSubmit={save} className="card space-y-4 max-w-3xl">
      {/* Horse image preview */}
      {form.image_url && (
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={form.image_url} alt={form.name} className="w-full max-w-sm h-48 rounded-xl object-cover" />
        </div>
      )}
      <div className="grid md:grid-cols-4 gap-3">
        <div className="md:col-span-2"><label className="label">名前</label><input className="input" value={form.name} onChange={set("name")} required /></div>
        <div><label className="label">カナ</label><input className="input" value={form.name_kana} onChange={set("name_kana")} /></div>
        <div><label className="label">性別</label><input className="input" value={form.sex} onChange={set("sex")} /></div>
        <div><label className="label">生年</label><input type="number" className="input" value={form.birth_year} onChange={set("birth_year")} /></div>
        <div className="md:col-span-3"><label className="label">紹介文</label><input className="input" value={form.profile} onChange={set("profile")} /></div>
        <div className="md:col-span-4"><label className="label">画像URL</label><input type="url" className="input" value={form.image_url} onChange={set("image_url")} placeholder="https://..." /></div>
        <div><label className="label">並び順</label><input type="number" className="input" value={form.sort_order} onChange={set("sort_order")} /></div>
        <label className="flex items-center gap-2">
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
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      <div className="flex items-center justify-between gap-3 border-t border-surface-line pt-4">
        <button className="btn-primary" disabled={busy}>{busy ? "保存中..." : "保存する"}</button>

        {/* 馬マスタからの削除。支援・契約などが紐づく馬はサーバー側(409)で拒否される。 */}
        {!confirmDelete ? (
          <button
            type="button"
            className="btn-ghost text-danger"
            onClick={() => { setConfirmDelete(true); setDelErr(null); }}
            disabled={deleting}
          >
            この馬を削除
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-danger">削除しますか？</span>
            <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              戻る
            </button>
            <button type="button" className="btn-danger" onClick={remove} disabled={deleting}>
              {deleting ? "削除中..." : "削除する"}
            </button>
          </div>
        )}
      </div>
      {delErr && <p className="text-sm text-danger">{delErr}</p>}
    </form>
  );
}
