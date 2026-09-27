import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetchAll";
import HorseMeetingAdminRow, { type HorseMeetingRow } from "./HorseMeetingRow";

export default async function AdminHorseMeetingsPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string };
}) {
  await requireCapability("bookings.manage");
  const status = searchParams?.status ?? "";
  const q = (searchParams?.q ?? "").trim();
  const supabase = createSupabaseServerClient();

  // 件数（{rows.length} 件）をそのまま表示するため、.limit(500) や PostgREST の
  // 1000 行上限で切られないよう最後までページングして全件を取得する。
  const { rows: records, error } = await fetchAllRows<any>((from, to) => {
    let query = supabase
      .from("horse_meeting_requests")
      .select("*, customer:customers(full_name, email)")
      .order("requested_at", { ascending: false })
      .order("id", { ascending: true });
    if (status) query = query.eq("status", status);
    if (q) {
      const like = `%${q}%`;
      query = query.or(
        `applicant_name.ilike.${like},supported_horses.ilike.${like},note.ilike.${like}`,
      );
    }
    return query.range(from, to);
  });

  const rows: HorseMeetingRow[] = records.map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    customer_name: r.customer?.full_name ?? "—",
    customer_email: r.customer?.email ?? "",
    applicant_name: r.applicant_name,
    facility: r.facility,
    party_size: r.party_size,
    preferred_date: r.preferred_date,
    preferred_time_slot: r.preferred_time_slot,
    supported_horses: r.supported_horses,
    arrival_method: r.arrival_method,
    pickup_time: r.pickup_time,
    note: r.note,
    status: r.status,
    admin_note: r.admin_note,
    requested_at: r.requested_at,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">馬の面会 申込一覧</h1>
          <p className="text-sm text-ink-soft mt-1">
            支援会員からの個別面会希望を管理します（イベントマスタへの日別登録は不要）。
          </p>
        </div>
        <span className="text-sm text-ink-soft">{rows.length} 件</span>
      </div>

      <form className="card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="label">検索</label>
          <input name="q" className="input" defaultValue={q} placeholder="氏名、支援馬、メモ..." />
        </div>
        <div>
          <label className="label">状態</label>
          <select name="status" className="input" defaultValue={status}>
            <option value="">すべて</option>
            <option value="pending">受付中</option>
            <option value="approved">承認済</option>
            <option value="completed">参加済</option>
            <option value="canceled">取消</option>
          </select>
        </div>
        <button className="btn-primary">絞り込む</button>
        {(q || status) && (
          <Link className="btn-ghost" href="/admin/horse-meetings">
            リセット
          </Link>
        )}
      </form>

      {error && <div className="card text-danger">{error.message}</div>}

      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>申込日時</th>
              <th>申込者</th>
              <th>会員</th>
              <th>施設</th>
              <th>希望日時</th>
              <th>人数</th>
              <th>支援馬</th>
              <th>来場</th>
              <th>状態</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <HorseMeetingAdminRow key={r.id} row={r} index={i + 1} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-6 text-ink-mute">
                  該当する申込がありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
