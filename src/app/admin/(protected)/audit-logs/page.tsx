import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { resolveMatchingIds, sanitizeSearch } from "@/lib/adminSearch";

const PAGE_SIZE = 100;

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams?: { action?: string; table?: string; q?: string; page?: string };
}) {
  await requireCapability("audit.view");
  const supabase = createSupabaseServerClient();
  const action = searchParams?.action ?? "";
  const table = searchParams?.table ?? "";
  const q = (searchParams?.q ?? "").trim();
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;

  // Search the whole table (not just the current page) via an RPC: it matches
  // action / target table, the meta JSON body, and the actor's name/email, and
  // returns the page of rows plus the total match count. Runs as SECURITY
  // INVOKER, so the "audit admin only" RLS policy still applies.
  let rows: any[] = [];
  let count = 0;
  const rpc = await supabase.rpc("search_audit_logs", {
    p_q: q || null,
    p_action: action || null,
    p_table: table || null,
    p_limit: PAGE_SIZE,
    p_offset: from,
  });
  if (!rpc.error) {
    rows = (rpc.data as any[]) ?? [];
    count = Number(rows[0]?.total_count ?? 0);
  } else {
    // Fallback if the RPC isn't deployed yet: query directly. Covers action /
    // target table / actor name+email across the whole table, but not the meta
    // JSON body (that needs the function). Keeps the page working in the gap
    // before the migration is applied.
    let query = supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    if (action) query = query.eq("action", action);
    if (table) query = query.eq("target_table", table);
    if (q) {
      const safe = sanitizeSearch(q);
      const orParts = [`action.ilike.*${safe}*`, `target_table.ilike.*${safe}*`];
      const custIds = await resolveMatchingIds(supabase, "customers", ["full_name", "email"], q);
      if (custIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id")
          .in("customer_id", custIds)
          .limit(1000);
        const matchedActorIds = (profs ?? []).map((p: any) => p.id);
        if (matchedActorIds.length) orParts.push(`actor_id.in.(${matchedActorIds.join(",")})`);
      }
      query = query.or(orParts.join(","));
    }
    const res = await query.range(from, from + PAGE_SIZE - 1);
    rows = (res.data as any[]) ?? [];
    count = res.count ?? 0;
  }

  // Lookup actor email for display
  const actorIds = Array.from(new Set(rows.map((l: any) => l.actor_id).filter(Boolean)));
  const actors = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, customer:customers(email, full_name)")
      .in("id", actorIds);
    for (const p of profiles ?? []) {
      const c = (p as any).customer;
      actors.set(
        (p as any).id,
        c ? `${c.full_name ?? ""} <${c.email ?? ""}>` : (p as any).id,
      );
    }
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const uniqueActions = [
    "plan.subscribe", "plan.cancel", "plan.create", "plan.update", "plan.disable", "plan.delete",
    "contract.create", "contract.update", "contract.cancel", "contract.delete",
    "support.create", "support.update", "support.cancel", "support.delete", "support.merge",
    "payment.update", "payment.delete",
    "donation.create", "donation.update", "donation.delete",
    "customer.create", "customer.update", "customer.withdraw",
    "event.create", "event.update", "event.unpublish", "event.delete",
    "booking.create", "booking.update", "booking.cancel", "booking.delete",
    "booking.self_create", "booking.self_update", "booking.self_cancel",
    "notify.donation_thanks", "notify.booking_confirmed", "notify.payment_failed", "notify.plan_changed",
  ];
  const uniqueTables = [
    "contracts", "support_subscriptions", "membership_plans",
    "customers", "donations", "payments", "bookings", "events",
    "notifications",
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">監査ログ</h1>
        <span className="text-sm text-ink-soft">全 {count ?? 0} 件</span>
      </div>

      <form className="card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="label">検索（メタ／アクション）</label>
          <input name="q" className="input" defaultValue={q} placeholder="例: donation, plan_changed, 顧客名..." />
        </div>
        <div>
          <label className="label">アクション</label>
          <select name="action" className="input" defaultValue={action}>
            <option value="">すべて</option>
            {uniqueActions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">対象テーブル</label>
          <select name="table" className="input" defaultValue={table}>
            <option value="">すべて</option>
            {uniqueTables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary">絞り込む</button>
        {(q || action || table) && (
          <Link className="btn-ghost" href="/admin/audit-logs">
            リセット
          </Link>
        )}
      </form>

      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>日時</th>
              <th>操作者</th>
              <th>アクション</th>
              <th>対象</th>
              <th>詳細</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((log: any, i: number) => (
              <tr key={log.id}>
                <td className="text-right text-ink-mute tabular-nums">{from + i + 1}</td>
                <td className="whitespace-nowrap">{formatDate(log.created_at, true)}</td>
                <td className="text-xs">
                  {log.actor_id ? actors.get(log.actor_id) ?? log.actor_id : "(システム)"}
                </td>
                <td>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-surface-soft border border-surface-line">
                    {log.action}
                  </span>
                </td>
                <td className="text-xs">
                  {log.target_table ?? "—"}
                  {log.target_id && <div className="font-mono text-[10px] text-ink-mute">{log.target_id}</div>}
                </td>
                <td>
                  <details>
                    <summary className="cursor-pointer text-xs text-brand">詳細</summary>
                    <pre className="text-[10px] whitespace-pre-wrap bg-surface-soft p-2 rounded mt-1">
                      {JSON.stringify(log.meta ?? {}, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-6 text-ink-mute">
                  ログがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => {
            const qs = new URLSearchParams();
            if (action) qs.set("action", action);
            if (table) qs.set("table", table);
            if (q) qs.set("q", q);
            qs.set("page", String(n));
            return (
              <Link
                key={n}
                href={`/admin/audit-logs?${qs.toString()}`}
                className={`px-3 py-1 rounded-lg border ${n === page ? "bg-brand text-white border-brand" : "border-surface-line"}`}
              >
                {n}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
