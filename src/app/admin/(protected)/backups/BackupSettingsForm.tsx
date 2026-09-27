"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Settings = { enabled: boolean; hourJst: number; retention: number };

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function BackupSettingsForm({
  initial,
  retentionMin,
  retentionMax,
}: {
  initial: Settings;
  retentionMin: number;
  retentionMax: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [hour, setHour] = useState(initial.hourJst);
  const [retention, setRetention] = useState(String(initial.retention));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(retention);
    if (!Number.isInteger(n) || n < retentionMin || n > retentionMax) {
      setMsg({ ok: false, text: `保存世代数は ${retentionMin}〜${retentionMax} の整数で入力してください。` });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/backups/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, hour_jst: hour, retention: n }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: j.error ?? "保存できませんでした。" });
      return;
    }
    setMsg({ ok: true, text: "保存しました。" });
    router.refresh();
  };

  return (
    <form onSubmit={save} className="card space-y-4">
      <label className="flex items-center gap-2 font-semibold">
        <input
          type="checkbox"
          className="w-5 h-5"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        毎日自動でバックアップする
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="backup-hour">
            実行時刻（日本時間）
          </label>
          <select
            id="backup-hour"
            className="input"
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-mute mt-1">アクセスの少ない深夜〜早朝がおすすめです。</p>
        </div>
        <div>
          <label className="label" htmlFor="backup-retention">
            自動バックアップの保存世代数
          </label>
          <input
            id="backup-retention"
            type="number"
            className="input"
            min={retentionMin}
            max={retentionMax}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
          <p className="text-xs text-ink-mute mt-1">
            この件数を超えた古い自動バックアップは削除されます（{retentionMin}〜{retentionMax}）。
          </p>
        </div>
      </div>

      {msg && <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>}
      <button className="btn-primary" type="submit" disabled={busy}>
        {busy ? "保存中..." : "設定を保存"}
      </button>
    </form>
  );
}
