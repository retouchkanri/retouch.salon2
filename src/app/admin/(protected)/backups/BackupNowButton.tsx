"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BackupNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    if (!confirm("今すぐデータベースのバックアップを作成しますか？（数十秒かかります）")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/backups", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          ok: false,
          text:
            j.error ??
            (res.status === 504
              ? "時間内に完了しませんでした。しばらくしてから再度お試しください。"
              : "バックアップに失敗しました。"),
        });
        return;
      }
      const mb = (Number(j.bytes ?? 0) / (1024 * 1024)).toFixed(1);
      setMsg({
        ok: true,
        text: `バックアップを作成しました（${Number(j.rowCount ?? 0).toLocaleString("ja-JP")} 行・${mb} MB）。`,
      });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "通信エラーが発生しました。" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3">
      <button className="btn-primary" type="button" onClick={run} disabled={busy}>
        {busy ? "バックアップ中…（20〜40 秒ほどかかります）" : "今すぐバックアップ"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
