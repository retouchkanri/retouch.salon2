"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = ["基本", "会員", "支援", "イベント", "お知らせ", "サポート", "一般"];

export default function KbForm({ initial, id }: { initial?: any; id?: string }) {
  const router = useRouter();
  const start = initial ?? { title: "", content: "", category: "一般", is_active: true };
  const [form, setForm] = useState<any>({ ...start });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set = (k: string) => (e: any) =>
    setForm((p: any) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch(id ? `/api/admin/chatbot/kb/${id}` : "/api/admin/chatbot/kb", {
      method: id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        content: form.content,
        category: form.category,
        is_active: form.is_active,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? "保存できませんでした。");
      return;
    }
    const j = await res.json().catch(() => ({}));
    setMsg(id ? "保存しました。" : `登録しました。${j.embedded ? "（学習済み）" : "（APIキー未設定のため未学習）"}`);
    if (!id) setForm(start);
    router.refresh();
  };

  return (
    <form onSubmit={save} className="card grid md:grid-cols-4 gap-3">
      <div className="md:col-span-3">
        <label className="label">タイトル（質問の見出し）</label>
        <input className="input" value={form.title} onChange={set("title")} maxLength={200} required />
      </div>
      <div>
        <label className="label">カテゴリ</label>
        <select className="input" value={form.category} onChange={set("category")}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="md:col-span-4">
        <label className="label">内容（回答に使う情報）</label>
        <textarea className="input" rows={4} value={form.content} onChange={set("content")} maxLength={8000} required />
      </div>
      <label className="flex items-center gap-2 md:col-span-2">
        <input type="checkbox" className="w-5 h-5" checked={form.is_active} onChange={set("is_active")} />
        <span>有効（検索対象にする）</span>
      </label>
      {msg && <p className="md:col-span-4 text-sm">{msg}</p>}
      <div className="md:col-span-4">
        <button className="btn-primary" disabled={busy}>{busy ? "保存中..." : id ? "保存する" : "ナレッジを追加"}</button>
      </div>
    </form>
  );
}
