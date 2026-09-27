"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReindexButton({ missingCount }: { missingCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (all: boolean) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/chatbot/reindex${all ? "?all=1" : ""}`, { method: "POST" });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "実行に失敗しました。");
      return;
    }
    setMsg(`学習完了: ${j.done} 件（失敗 ${j.failed}）`);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-ink-mute">{msg}</span>}
      <button className="btn-secondary text-sm" disabled={busy} onClick={() => run(false)}>
        {busy ? "処理中..." : `埋め込みを再生成${missingCount ? `（${missingCount}）` : ""}`}
      </button>
    </div>
  );
}
