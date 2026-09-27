"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type BookingView = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  party_size: number;
  note: string;
  status: string;
  status_label: string;
  booked_at: string;
};

export default function BookingRow({ booking, index }: { booking: BookingView; index: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [partySize, setPartySize] = useState(String(booking.party_size));
  const [status, setStatus] = useState(booking.status);
  const [note, setNote] = useState(booking.note);

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/bookings/${booking.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        party_size: Number(partySize),
        status,
        note: note || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "保存できませんでした");
      return;
    }
    setEditing(false);
    router.refresh();
  };

  const cancelBooking = async () => {
    if (!confirm("この予約をキャンセルしますか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/bookings/${booking.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "キャンセルできませんでした");
      return;
    }
    router.refresh();
  };

  const hardDelete = async () => {
    if (!confirm("予約レコードを完全に削除します。よろしいですか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/bookings/${booking.id}?hard=1`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "削除できませんでした");
      return;
    }
    router.refresh();
  };

  return (
    <>
      <tr>
        <td className="text-right text-ink-mute tabular-nums">{index}</td>
        <td>{booking.customer_name}</td>
        <td>{booking.customer_email || "—"}</td>
        <td>{booking.party_size}</td>
        <td>{booking.booked_at}</td>
        <td>{booking.status_label}</td>
        <td className="text-right whitespace-nowrap">
          <button className="text-brand underline text-sm mr-3" onClick={() => setEditing((v) => !v)}>
            編集
          </button>
          {booking.status !== "canceled" && (
            <button className="text-amber-700 underline text-sm mr-3" onClick={cancelBooking} disabled={busy}>
              取消
            </button>
          )}
          <button className="text-danger underline text-sm" onClick={hardDelete} disabled={busy}>
            削除
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={7} className="bg-surface-soft">
            <div className="p-3 grid sm:grid-cols-4 gap-3">
              <div>
                <label className="label">人数</label>
                <input type="number" className="input" value={partySize} onChange={(e) => setPartySize(e.target.value)} min={1} max={20} />
              </div>
              <div>
                <label className="label">状態</label>
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="reserved">予約中</option>
                  <option value="attended">参加済</option>
                  <option value="no_show">不参加</option>
                  <option value="canceled">キャンセル</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">メモ</label>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="sm:col-span-4 flex gap-2">
                <button className="btn-primary" onClick={save} disabled={busy}>
                  保存
                </button>
                <button className="btn-ghost" onClick={() => setEditing(false)}>
                  閉じる
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
