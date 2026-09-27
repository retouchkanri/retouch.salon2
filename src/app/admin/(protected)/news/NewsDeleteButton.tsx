"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewsDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`「${title}」を削除しますか？`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/news/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "削除に失敗しました。");
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className="text-red-600 underline text-sm"
    >
      {busy ? "削除中..." : "削除"}
    </button>
  );
}
