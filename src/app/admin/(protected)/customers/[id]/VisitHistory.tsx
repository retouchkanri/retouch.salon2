"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";

export type VisitBooking = {
  id: string;
  status: string;
  party_size: number;
  event: {
    type: string | null;
    title: string | null;
    starts_at: string | null;
    location: string | null;
  } | null;
};

const STATUS_LABEL: Record<string, string> = {
  reserved: "予約中",
  attended: "参加済",
  no_show: "不参加",
  canceled: "取消",
};

/**
 * 顧客ごとの見学会・個別見学の参加履歴。
 * 「いつ・どこ（場所＝大阪/千葉など）」を確認でき、キャンセル等の誤登録は
 * 手動で完全削除できる（DELETE ?hard=1）。
 */
export default function VisitHistory({ bookings }: { bookings: VisitBooking[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function remove(b: VisitBooking) {
    const where = b.event?.location?.trim() ? ` / ${b.event.location.trim()}` : "";
    const label = `${b.event?.title ?? "（不明な見学会）"}（${formatDate(b.event?.starts_at, true)}${where}）`;
    if (!window.confirm(`この見学予約を完全に削除しますか？\n${label}\n\nこの操作は元に戻せません。`)) return;
    setBusy(b.id);
    setErr(null);
    const res = await fetch(`/api/admin/bookings/${b.id}?hard=1`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "削除に失敗しました。");
      return;
    }
    router.refresh();
  }

  return (
    <>
      {err && <p className="text-danger text-sm mb-2">{err}</p>}
      <table className="table">
        <thead>
          <tr>
            <th className="w-12 text-right">No.</th>
            <th>種別</th>
            <th>タイトル</th>
            <th>日時</th>
            <th>場所</th>
            <th>人数</th>
            <th>状態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b, i) => (
            <tr key={b.id}>
              <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
              <td>{b.event?.type === "private_visit" ? "個別見学" : "見学会"}</td>
              <td>{b.event?.title ?? "—"}</td>
              <td className="whitespace-nowrap">{formatDate(b.event?.starts_at, true)}</td>
              <td>{b.event?.location?.trim() ? b.event.location : "—"}</td>
              <td>{b.party_size}</td>
              <td>{STATUS_LABEL[b.status] ?? b.status}</td>
              <td className="text-right">
                <button
                  className="text-danger underline text-sm disabled:opacity-50"
                  onClick={() => remove(b)}
                  disabled={busy === b.id}
                >
                  {busy === b.id ? "削除中..." : "削除"}
                </button>
              </td>
            </tr>
          ))}
          {bookings.length === 0 && (
            <tr>
              <td colSpan={8} className="text-center text-ink-mute py-3">
                見学履歴はまだありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
