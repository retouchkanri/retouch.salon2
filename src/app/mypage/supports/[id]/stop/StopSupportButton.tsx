"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StopSupportButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/mypage/supports/${id}/stop`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(j.error ?? "停止できませんでした。時間をおいて再度お試しください。");
      return;
    }
    router.replace("/mypage");
    router.refresh();
  };

  if (!confirmOpen) {
    return (
      <div>
        {error && <p className="text-danger text-sm mb-2">{error}</p>}
        <button
          className="btn-danger w-full"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
        >
          停止内容を確認する
        </button>
      </div>
    );
  }

  return (
    <div className="card border-2 border-danger">
      <p className="font-bold text-danger">本当に停止してよろしいですか？</p>
      <p className="text-sm mt-1">
        次回更新日をもって、この支援の継続課金を停止します。
      </p>
      {error && <p className="text-danger text-sm mt-2">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        <button className="btn-ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
          戻る
        </button>
        <button className="btn-danger" onClick={run} disabled={busy}>
          {busy ? "処理中..." : "この支援を停止する"}
        </button>
      </div>
    </div>
  );
}
