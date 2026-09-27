"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BackupDeleteButton({ name, label }: { name: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm(`${label} のバックアップを削除しますか？（元に戻せません）`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
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
