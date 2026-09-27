"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 支援者のいる馬ごとの支援者チャンネルをまとめて作成する。 */
export default function HorseChannelsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    if (
      !window.confirm(
        "現在支援者がいる馬ごとに「〇〇の支援者」チャンネルを作成します（その馬を支援中の会員だけが参加できます）。\n作成済みの馬はスキップします。よろしいですか？",
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/community/channels/horses", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: j.error ?? "作成できませんでした。" });
      return;
    }
    setMsg({ ok: true, text: j.created > 0 ? `${j.created}件のチャンネルを作成しました。` : "新たに作成するチャンネルはありませんでした。" });
    router.refresh();
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={busy} className="btn-secondary !px-4 !py-2 text-sm">
        {busy ? "作成中…" : "🐴 馬ごとの支援者チャンネルを作成"}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-danger"}`}>{msg.text}</span>}
    </span>
  );
}
