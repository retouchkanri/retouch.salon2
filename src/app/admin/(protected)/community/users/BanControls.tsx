"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** コミュニティの利用停止・解除。 */
export default function BanControls({ userId, banned, name }: { userId: string; banned: boolean; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState<string>("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ban = async () => {
    if (!window.confirm(`${name} さんのコミュニティ利用を停止しますか？`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/community/users/${userId}/ban`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, days: days === "forever" ? null : Number(days) }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(j.error ?? "停止できませんでした。");
      return;
    }
    setOpen(false);
    router.refresh();
  };

  const unban = async () => {
    if (!window.confirm(`${name} さんの利用停止を解除しますか？`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/community/users/${userId}/ban`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(j.error ?? "解除できませんでした。");
      return;
    }
    router.refresh();
  };

  if (banned) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button type="button" onClick={unban} disabled={busy} className="text-brand underline text-sm">
          停止を解除
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </span>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-danger underline text-sm">
        利用停止
      </button>
    );
  }
  return (
    <div className="space-y-1.5 min-w-[220px]">
      <select className="input !py-1.5 text-sm" value={days} onChange={(e) => setDays(e.target.value)}>
        <option value="1">1日間</option>
        <option value="7">7日間</option>
        <option value="30">30日間</option>
        <option value="forever">無期限</option>
      </select>
      <input className="input !py-1.5 text-sm" placeholder="理由（運営用メモ・本人には表示されません）" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" onClick={ban} disabled={busy} className="btn-danger !px-3 !py-1 text-xs">
          {busy ? "処理中…" : "停止する"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs underline text-ink-mute">
          キャンセル
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
