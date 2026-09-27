import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { loadBookings, loadDonations, loadPayments } from "@/lib/customer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatUnits, formatYen, statusLabel } from "@/lib/format";

export default async function HistoryPage() {
  const session = await requireMember();
  if (!session.customerId) return <div className="card">会員情報が見つかりません。</div>;

  const admin = createSupabaseAdminClient();
  const { data: supportRows } = await admin
    .from("support_subscriptions")
    .select("id")
    .eq("customer_id", session.customerId);
  const supportIds = (supportRows ?? []).map((r: any) => r.id);

  const [donations, bookings, payments, supportAuditsResult] = await Promise.all([
    loadDonations(session.customerId),
    // 「全履歴」ページなので件数を切らない（null = 全件ページング取得）。
    loadBookings(session.customerId, null),
    loadPayments(session.customerId, null),
    supportIds.length
      ? admin
          .from("audit_logs")
          .select("id, action, meta, created_at")
          .eq("target_table", "support_subscriptions")
          .in("target_id", supportIds)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const supportAudits = (supportAuditsResult as any).data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">履歴</h1>
        <Link href="/mypage" className="text-brand underline">戻る</Link>
      </div>

      <section className="card">
        <h2 className="section-title">支援の変更・停止履歴</h2>
        {supportAudits.length === 0 ? (
          <p className="text-ink-mute">支援の変更・停止履歴はまだありません。</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {supportAudits.map((a: any) => {
              const m = a.meta ?? {};
              const kind =
                a.action === "support.create" ? "新規追加" :
                a.action === "support.update" ? "変更" :
                a.action === "support.cancel" ? "停止" : a.action;
              const chipClass =
                a.action === "support.create" ? "chip-ok" :
                a.action === "support.cancel" ? "chip-error" : "chip-warn";
              let detail = "—";
              if (a.action === "support.create") {
                detail = `${formatUnits(m.units)} / ${formatYen(m.monthly)}`;
              } else if (a.action === "support.update") {
                const from = `${formatUnits(m.prev_units)} (${formatYen(m.prev_monthly)})`;
                const to = `${formatUnits(m.units)} (${formatYen(m.monthly)})`;
                detail = `${from} → ${to}`;
              } else if (a.action === "support.cancel") {
                detail = `${formatUnits(m.units)} / ${formatYen(m.monthly)} を停止`;
              }
              return (
                <li key={a.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold truncate">{m.horse_name ?? "—"}</p>
                    <p className="text-xs text-ink-soft">{formatDate(a.created_at, true)} ・ {detail}</p>
                  </div>
                  <span className={chipClass}>{kind}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">決済履歴</h2>
        {payments.length === 0 ? (
          <p className="text-ink-mute">まだ決済履歴はありません。</p>
        ) : (
          <table className="table">
            <thead><tr><th className="w-12 text-right">No.</th><th>日時</th><th>種別</th><th>金額</th><th>状態</th></tr></thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={p.id}>
                  <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                  <td>{formatDate(p.occurred_at, true)}</td>
                  <td>{p.kind === "donation" ? "単発寄付" : p.kind === "subscription" ? "継続決済" : "一回払い"}</td>
                  <td>{formatYen(p.amount)}</td>
                  <td>{statusLabel(p.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">寄付履歴</h2>
        {donations.length === 0 ? (
          <p className="text-ink-mute">寄付履歴はまだありません。</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {donations.map((d) => (
              <li key={d.id} className="py-2 flex items-center justify-between">
                <div>
                  <p className="font-bold">{formatYen(d.amount)}</p>
                  <p className="text-xs text-ink-soft">{formatDate(d.donated_at, true)}</p>
                </div>
                <span className={d.status === "succeeded" ? "chip-ok" : "chip-warn"}>{statusLabel(d.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">見学履歴</h2>
        {bookings.length === 0 ? (
          <p className="text-ink-mute">見学履歴はまだありません。</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {bookings.map((b) => (
              <li key={b.id} className="py-2 flex items-center justify-between">
                <div>
                  <p className="font-bold">{b.event?.title}</p>
                  <p className="text-xs text-ink-soft">{formatDate(b.event?.starts_at, true)}</p>
                </div>
                <span className={b.status === "reserved" || b.status === "attended" ? "chip-ok" : "chip-mute"}>
                  {statusLabel(b.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
