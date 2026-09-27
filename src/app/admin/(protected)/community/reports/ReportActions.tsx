"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReportActions({
  reportId,
  status,
  messageId,
  messageDeleted,
}: {
  reportId: string;
  status: "open" | "resolved" | "dismissed";
  messageId: string | null;
  messageDeleted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = async (next: "open" | "resolved" | "dismissed") => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/community/reports/${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(j.error ?? "更新できませんでした。");
      return;
    }
    router.refresh();
  };

  const deleteMessage = async () => {
    if (!messageId) return;
    if (!window.confirm("このメッセージを削除しますか？（元に戻せません）")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/community/messages/${messageId}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(j.error ?? "削除できませんでした。");
      return;
    }
    await setStatus("resolved");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {messageId && !messageDeleted && (
        <button type="button" onClick={deleteMessage} disabled={busy} className="btn-danger !px-3 !py-1.5 text-xs">
          メッセージを削除して対応済みにする
        </button>
      )}
      {status === "open" ? (
        <>
          <button type="button" onClick={() => setStatus("resolved")} disabled={busy} className="btn-secondary !px-3 !py-1.5 text-xs">
            対応済みにする
          </button>
          <button type="button" onClick={() => setStatus("dismissed")} disabled={busy} className="btn-ghost !px-3 !py-1.5 text-xs">
            問題なし
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setStatus("open")} disabled={busy} className="btn-ghost !px-3 !py-1.5 text-xs">
          未対応に戻す
        </button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
