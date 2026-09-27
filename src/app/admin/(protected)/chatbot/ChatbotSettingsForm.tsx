"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChatbotSettingsForm({ initialPrompt }: { initialPrompt: string }) {
  const router = useRouter();
  const [content, setContent] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/chatbot/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system_prompt: content }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: j.error ?? "保存できませんでした。" });
      return;
    }
    setMsg({ ok: true, text: "保存しました。AIが有効になりました。" });
    router.refresh();
  };

  return (
    <form onSubmit={save} className="card space-y-3">
      <div>
        <label className="label">補足指示・情報（任意）</label>
        <textarea
          className="input"
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="チャットボットへの補足指示や特有の情報を入力（省略可）"
          maxLength={8000}
        />
        <p className="text-xs text-ink-mute mt-1">
          ここに書いた内容はAIのシステムプロンプトに追記されます。空白でも保存できます。
        </p>
      </div>
      {msg && (
        <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>
      )}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "保存中..." : "設定を保存してAIを有効化"}
      </button>
    </form>
  );
}
