"use client";
import { useState } from "react";

export default function NewsletterToggle({ initialOptOut }: { initialOptOut: boolean }) {
  const [optOut, setOptOut] = useState(initialOptOut);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const update = async (next: boolean) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/mypage/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ opt_out: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg("更新に失敗しました。時間をおいて再度お試しください。");
      return;
    }
    setOptOut(next);
    setMsg(next ? "メルマガの配信を停止しました。" : "メルマガを受け取る設定にしました。");
  };

  return (
    <div className="card space-y-3">
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="font-semibold">メールマガジンを受け取る</span>
          <span className="block text-sm text-ink-mute">イベント・お知らせなどのメール配信を受け取ります。</span>
        </span>
        <input
          type="checkbox"
          className="w-6 h-6"
          checked={!optOut}
          disabled={busy}
          onChange={(e) => update(!e.target.checked)}
        />
      </label>
      {msg && <p className="text-sm">{msg}</p>}
      <p className="text-xs text-ink-mute">
        ※ 配信停止後も、ご契約・お支払いに関する重要なご連絡はお送りします。
      </p>
    </div>
  );
}
