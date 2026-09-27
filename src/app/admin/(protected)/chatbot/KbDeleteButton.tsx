"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function KbDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm(`「${title}」を削除しますか？`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/chatbot/kb/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "削除に失敗しました。");
      return;
    }
    router.refresh();
  };

  return (
    <button onClick={remove} disabled={busy} className="text-danger underline text-sm">
      削除
    </button>
  );
}
