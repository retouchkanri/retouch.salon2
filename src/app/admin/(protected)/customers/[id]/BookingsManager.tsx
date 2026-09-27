"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EventRow = {
  id: string;
  type: string;
  title: string;
  starts_at: string;
  supporters_only: boolean;
};

type Booking = {
  id: string;
  status: string;
  party_size: number;
  note: string | null;
  event?: EventRow | null;
};

function formatDateTime(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const statusOptions = [
  { value: "reserved", label: "予約中" },
  { value: "attended", label: "参加済" },
  { value: "no_show", label: "不参加" },
  { value: "canceled", label: "取消" },
];

export default function BookingsManager({
  customerId,
  bookings,
  events,
}: {
  customerId: string;
  bookings: Booking[];
  events: EventRow[];
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [partySize, setPartySize] = useState("1");
  const [note, setNote] = useState("");

  const create = async () => {
    if (!eventId) return;
    setBusy("__add");
    setErr(null);
    const res = await fetch("/api/admin/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId,
        event_id: eventId,
        party_size: Number(partySize),
        note: note || null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.error ?? "登録に失敗しました");
    setAddOpen(false);
    setPartySize("1");
    setNote("");
    router.refresh();
  };

  const updateStatus = async (id: string, status: string) => {
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/admin/bookings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "更新に失敗しました");
    }
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-mute">{bookings.length}件</p>
        {!addOpen ? (
          <button
            className="btn-primary !py-1.5 !px-3 text-sm"
            onClick={() => setAddOpen(true)}
            disabled={events.length === 0}
          >
            ＋ 予約を追加
          </button>
        ) : (
          <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setAddOpen(false)}>
            キャンセル
          </button>
        )}
      </div>

      {addOpen && (
        <div className="grid md:grid-cols-4 gap-2 p-3 bg-surface-soft rounded-xl border border-surface-line">
          <div className="md:col-span-2">
            <label className="label">イベント</label>
            <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.type === "private_visit" ? "個別" : "見学"}: {e.title}（{formatDateTime(e.starts_at)}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">人数</label>
            <input
              className="input"
              type="number"
              min="1"
              max="20"
              value={partySize}
              onChange={(e) => setPartySize(e.target.value)}
            />
          </div>
          <div>
            <label className="label">メモ</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="md:col-span-4">
            <button className="btn-primary" onClick={create} disabled={busy === "__add"}>
              {busy === "__add" ? "登録中..." : "予約を追加"}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-danger text-sm">{err}</p>}

      <table className="table">
        <thead>
          <tr>
            <th className="w-12 text-right">No.</th>
            <th>種別</th>
            <th>タイトル</th>
            <th>日時</th>
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
              <td>{formatDateTime(b.event?.starts_at)}</td>
              <td>{b.party_size}名</td>
              <td>
                <select
                  className="input !py-1 text-sm"
                  value={b.status}
                  onChange={(e) => updateStatus(b.id, e.target.value)}
                  disabled={busy === b.id}
                >
                  {statusOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="text-right">
                {b.status !== "canceled" && (
                  <button
                    className="btn-danger !py-1 !px-2 text-xs"
                    onClick={() => updateStatus(b.id, "canceled")}
                    disabled={busy === b.id}
                  >
                    取消
                  </button>
                )}
              </td>
            </tr>
          ))}
          {bookings.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-ink-mute py-3">
                予約履歴はまだありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
