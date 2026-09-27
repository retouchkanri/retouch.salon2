"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (full: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/payments/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ full }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error ?? "同期に失敗しました");
        return;
      }
      setMsg(`${j.synced ?? 0}件を同期${j.skipped ? `（${j.skipped}件は既存）` : ""}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      <a href="/api/admin/csv/payments" className="btn-ghost !py-2 !px-4 text-sm">
        CSVダウンロード
      </a>
      <button className="btn-secondary !py-2 !px-4 text-sm" disabled={busy} onClick={() => run(false)}>
        {busy ? "同期中..." : "Stripeと同期"}
      </button>
      <button
        className="btn-ghost !py-2 !px-3 text-xs"
        disabled={busy}
        onClick={() => run(true)}
        title="Stripeの全決済履歴を取り込み直します（時間がかかる場合があります）"
      >
        全件再取得
      </button>
    </div>
  );
}
