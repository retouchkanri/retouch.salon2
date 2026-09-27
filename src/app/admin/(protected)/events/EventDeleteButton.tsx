"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EventDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!confirm(`「${title}」を完全に削除しますか？\n予約が残っている場合は削除できません。\nこの操作は元に戻せません。`)) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/events/${id}?hard=1`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? "削除できませんでした。");
      return;
    }
    router.push("/admin/events");
    router.refresh();
  };

  return (
    <div className="card border-danger/30 bg-red-50 space-y-2">
      <p className="text-sm font-bold text-danger">危険な操作</p>
      <p className="text-xs text-ink-soft">
        予約レコードが存在する場合は削除できません。まず全予約をキャンセルしてから削除してください。
      </p>
      {msg && <p className="text-sm text-danger">{msg}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="btn-ghost text-danger border border-danger/40 text-sm !py-2"
      >
        {busy ? "削除中..." : "このイベントを削除する"}
      </button>
    </div>
  );
}
