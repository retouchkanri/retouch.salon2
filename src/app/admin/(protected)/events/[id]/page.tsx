import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { seatUsage } from "@/lib/bookings";
import { eventVenue, pickupLabel, relationLabel, venueLabel } from "@/lib/events";
import { formatDate, statusLabel } from "@/lib/format";
import EventForm from "../EventForm";
import EventDeleteButton from "../EventDeleteButton";

const ACTION_LABEL: Record<string, string> = {
  "booking.create": "管理者：追加",
  "booking.update": "管理者：変更",
  "booking.cancel": "管理者：取消",
  "booking.delete": "管理者：削除",
  "booking.self_create": "会員：申込",
  "booking.self_update": "会員：変更",
  "booking.self_cancel": "会員：取消",
  "event.create": "イベント作成",
  "event.update": "イベント更新",
  "event.unpublish": "イベント非公開",
  "event.delete": "イベント削除",
};

function actionChip(action: string): string {
  if (action.endsWith(".cancel") || action.endsWith(".delete")) return "chip-error";
  if (action.endsWith(".create") || action.endsWith(".self_create")) return "chip-ok";
  return "chip-warn";
}

export default async function EditEventPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("events").select("*").eq("id", params.id).maybeSingle();
  if (!data) return notFound();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*, customer:customers(id, full_name, email)")
    .eq("event_id", params.id)
    .order("booked_at");

  const admin = createSupabaseAdminClient();
  const usage = await seatUsage(admin as any, data as any);
  const isVisit = (data as any).type === "visit";
  const venue = eventVenue(data as any);

  const bookingIds = (bookings ?? []).map((b: any) => b.id);
  const auditFilters = ["booking.create", "booking.update", "booking.cancel", "booking.delete",
    "booking.self_create", "booking.self_update", "booking.self_cancel"];
  const { data: bookingHistory } = bookingIds.length
    ? await supabase
        .from("audit_logs")
        .select("id, actor_id, action, target_id, meta, created_at")
        .eq("target_table", "bookings")
        .in("action", auditFilters)
        .in("target_id", bookingIds)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] as any[] };

  const { data: eventHistory } = await supabase
    .from("audit_logs")
    .select("id, actor_id, action, meta, created_at")
    .eq("target_table", "events")
    .eq("target_id", params.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const customerById = new Map<string, { full_name: string; email: string | null }>();
  for (const b of bookings ?? []) {
    const c: any = (b as any).customer;
    if (c?.id) customerById.set(c.id, { full_name: c.full_name, email: c.email });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-bold">イベント編集</h1>
        <Link className="text-brand underline" href="/admin/events">← 戻る</Link>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card"><p className="text-xs text-ink-soft">定員</p><p className="text-2xl font-bold">{usage.capacity}</p></div>
        <div className="card"><p className="text-xs text-ink-soft">予約席数</p><p className="text-2xl font-bold">{usage.used}</p></div>
        <div className="card"><p className="text-xs text-ink-soft">残席</p>
          <p className={`text-2xl font-bold ${usage.remaining === 0 ? "text-danger" : ""}`}>{usage.remaining}</p>
        </div>
      </div>

      <EventForm initial={data} id={params.id} />
      <EventDeleteButton id={params.id} title={(data as any).title} />

      <section className="card">
        <h2 className="section-title">
          参加者一覧（{(bookings ?? []).length}件）
          {isVisit && venue && <span className="chip-mute ml-2">{venueLabel(venue)}会場</span>}
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>氏名</th>
              <th>メール</th>
              <th>人数</th>
              {isVisit && <th>送迎</th>}
              {isVisit && venue === "chiba" && <th>体験乗馬</th>}
              {isVisit && <th>同伴者</th>}
              <th>状態</th>
              <th>予約日時</th>
            </tr>
          </thead>
          <tbody>
            {(bookings ?? []).map((b: any, i: number) => {
              const companions = (b.companions ?? []) as { name: string; relation: string }[];
              return (
                <tr key={b.id}>
                  <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                  <td>{b.customer?.full_name ?? "—"}</td>
                  <td>{b.customer?.email ?? "—"}</td>
                  <td>{b.party_size}</td>
                  {isVisit && (
                    <td className="text-xs">{pickupLabel(venue, b.pickup) ?? "—"}</td>
                  )}
                  {isVisit && venue === "chiba" && (
                    <td className="text-xs">{b.riding ? "希望" : "—"}</td>
                  )}
                  {isVisit && (
                    <td className="text-xs">
                      {companions.length === 0
                        ? "—"
                        : companions
                            .map((c) => `${c.name}（${relationLabel(c.relation)}）`)
                            .join("、")}
                    </td>
                  )}
                  <td>{statusLabel(b.status)}</td>
                  <td className="text-xs text-ink-mute">{formatDate(b.booked_at, true)}</td>
                </tr>
              );
            })}
            {(bookings ?? []).length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-ink-mute py-3">
                  まだ予約はありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="section-title">予約変更・キャンセル履歴（{(bookingHistory ?? []).length}件）</h2>
        {(bookingHistory ?? []).length === 0 ? (
          <p className="text-sm text-ink-mute">操作履歴はまだありません。</p>
        ) : (
          <table className="table">
            <thead><tr><th className="w-12 text-right">No.</th><th>日時</th><th>操作</th><th>対象会員</th><th>内容</th></tr></thead>
            <tbody>
              {(bookingHistory ?? []).map((log: any, i: number) => {
                const m = log.meta ?? {};
                const targetBooking = (bookings ?? []).find((b: any) => b.id === log.target_id);
                const cust = targetBooking?.customer;
                let detail = "—";
                if (log.action.endsWith("create") || log.action.endsWith("self_create")) {
                  detail = `${m.party_size ?? "?"}名`;
                } else if (log.action.endsWith("update") || log.action.endsWith("self_update")) {
                  const prev = m.prev ?? {};
                  const next = m.next ?? {};
                  if (prev.party_size !== undefined && next.party_size !== undefined) {
                    detail = `人数 ${prev.party_size} → ${next.party_size}`;
                  } else if (next.status) {
                    detail = `状態 → ${statusLabel(next.status)}`;
                  } else {
                    detail = JSON.stringify(next).slice(0, 80);
                  }
                } else if (log.action.endsWith("cancel") || log.action.endsWith("delete")) {
                  detail = `${m.party_size ?? ""}名 ${log.action.endsWith("delete") ? "削除" : "取消"}`;
                }
                return (
                  <tr key={log.id}>
                    <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                    <td className="whitespace-nowrap text-xs">{formatDate(log.created_at, true)}</td>
                    <td>
                      <span className={ACTION_LABEL[log.action] ? actionChip(log.action) : "chip-mute"}>
                        {ACTION_LABEL[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="text-xs">{cust?.full_name ?? "—"}</td>
                    <td className="text-xs">{detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">イベント設定変更履歴</h2>
        {(eventHistory ?? []).length === 0 ? (
          <p className="text-sm text-ink-mute">変更履歴はまだありません。</p>
        ) : (
          <ul className="text-xs space-y-2">
            {(eventHistory ?? []).map((log: any) => (
              <li key={log.id} className="border-b border-surface-line pb-2">
                <div className="flex items-center gap-2">
                  <span className={actionChip(log.action)}>{ACTION_LABEL[log.action] ?? log.action}</span>
                  <span className="text-ink-mute">{formatDate(log.created_at, true)}</span>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-brand">詳細</summary>
                  <pre className="bg-surface-soft p-2 rounded mt-1 whitespace-pre-wrap">
                    {JSON.stringify(log.meta ?? {}, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {customerById.size === 0 && null}
    </div>
  );
}
