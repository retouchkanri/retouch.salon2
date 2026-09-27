import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, statusLabel } from "@/lib/format";
import BookingRow from "./BookingRow";
import AddBookingForm from "./AddBookingForm";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: { event?: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data: events } = await supabase
    .from("events")
    .select("id,title,starts_at,capacity,type,supporters_only,location")
    .order("starts_at", { ascending: false })
    .limit(50);

  const selectedId = searchParams.event || (events?.[0] as any)?.id || "";
  const selectedEvent = (events ?? []).find((e: any) => e.id === selectedId);
  const { data: bookings } = selectedId
    ? await supabase
        .from("bookings")
        .select("*, customer:customers(id,full_name,email)")
        .eq("event_id", selectedId)
        .order("booked_at")
    : ({ data: [] } as any);

  const reservedCount = (bookings ?? [])
    .filter((b: any) => b.status !== "canceled")
    .reduce((a: number, b: any) => a + Number(b.party_size ?? 1), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">予約管理</h1>
      <form method="get" className="card flex items-center gap-2">
        <label className="label m-0 flex-shrink-0">イベント</label>
        <select name="event" defaultValue={selectedId} className="input flex-1">
          {(events ?? []).map((e: any) => (
            <option key={e.id} value={e.id}>
              [{e.type === "private_visit" ? "個別" : "見学"}] {e.title}（{formatDate(e.starts_at, true)}）
            </option>
          ))}
        </select>
        <button className="btn-primary !py-2 !px-4">表示</button>
      </form>

      {selectedEvent && (
        <div className="card">
          <div className="flex flex-wrap gap-3 text-sm">
            <p>
              <span className="text-ink-soft">日時</span>{" "}
              <span className="font-bold">{formatDate((selectedEvent as any).starts_at, true)}</span>
            </p>
            <p>
              <span className="text-ink-soft">場所</span>{" "}
              <span className="font-bold">{(selectedEvent as any).location?.trim() ? (selectedEvent as any).location : "—"}</span>
            </p>
            <p>
              <span className="text-ink-soft">定員</span>{" "}
              <span className="font-bold">{(selectedEvent as any).capacity}</span>
            </p>
            <p>
              <span className="text-ink-soft">予約数</span> <span className="font-bold">{reservedCount}</span>
            </p>
            <p>
              <span className="text-ink-soft">残席</span>{" "}
              <span className="font-bold">{Math.max(0, (selectedEvent as any).capacity - reservedCount)}</span>
            </p>
          </div>
        </div>
      )}

      {selectedId && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">＋ 予約を追加</summary>
          <div className="mt-3">
            <AddBookingForm eventId={selectedId} />
          </div>
        </details>
      )}

      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>氏名</th>
              <th>メール</th>
              <th>人数</th>
              <th>予約日時</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(bookings ?? []).map((b: any, i: number) => (
              <BookingRow
                key={b.id}
                index={i + 1}
                booking={{
                  id: b.id,
                  customer_id: b.customer?.id ?? b.customer_id,
                  customer_name: b.customer?.full_name ?? "—",
                  customer_email: b.customer?.email ?? "",
                  party_size: Number(b.party_size ?? 1),
                  note: b.note ?? "",
                  status: b.status,
                  status_label: statusLabel(b.status),
                  booked_at: formatDate(b.booked_at, true),
                }}
              />
            ))}
            {(bookings ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-ink-mute py-6">
                  予約はありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-mute">
        <Link href="/admin/events" className="underline">
          イベントマスタで新しいイベントを作成
        </Link>
        することもできます。
      </p>
    </div>
  );
}
