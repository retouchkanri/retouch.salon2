"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerDeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    if (
      !confirm(
        `「${name}」を完全に削除します。\n契約・一口支援・予約・面会申込・管理メモなど、この顧客に紐づく全てのデータも削除され、元に戻せません。\n本当によろしいですか？`
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/admin/customers/${id}`, { method: "DELETE" });
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
      className="text-red-600 underline text-sm disabled:opacity-50"
    >
      {busy ? "削除中..." : "削除"}
    </button>
  );
}
