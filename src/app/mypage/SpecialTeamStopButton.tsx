"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SpecialTeamStopButton({ id, horseName }: { id: string; horseName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const stop = async () => {
    if (!confirm(`${horseName} の特別チーム会員を停止しますか？`)) return;
    setBusy(true);
    const res = await fetch(`/api/mypage/special-team/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "停止できませんでした。");
    }
  };

  return (
    <button
      onClick={stop}
      disabled={busy}
      className="btn-ghost !py-2 !px-3 text-sm text-danger shrink-0"
    >
      {busy ? "処理中..." : "停止"}
    </button>
  );
}
