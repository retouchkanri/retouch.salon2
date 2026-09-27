import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { formatDate, formatYen, statusLabel } from "@/lib/format";
import { NO_MATCH_ID, resolveMatchingIds } from "@/lib/adminSearch";
import ContractRow from "./ContractRow";

const PAGE_SIZE = 50;

type SortKey = "customer" | "plan" | "monthly" | "status" | "started" | "period_end";

// 並び替え可能な列: URL の sort= 値 → 実列名（joinされたテーブルの列は foreignTable で指定）。
const SORT_COLUMNS: Record<SortKey, { column: string; foreignTable?: string }> = {
  customer: { column: "full_name", foreignTable: "customer" },
  plan: { column: "name", foreignTable: "plan" },
  monthly: { column: "monthly_amount", foreignTable: "plan" },
  status: { column: "status" },
  started: { column: "started_at" },
  period_end: { column: "current_period_end" },
};

export default async function AdminContractsPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string; page?: string; sort?: string; dir?: string };
}) {
  await requireCapability("contracts.manage");
  const supabase = createSupabaseServerClient();
  const status = searchParams?.status ?? "";
  const q = (searchParams?.q ?? "").trim();
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const activeSort: SortKey | null =
    searchParams?.sort && searchParams.sort in SORT_COLUMNS ? (searchParams.sort as SortKey) : null;
  const activeDir: "asc" | "desc" = searchParams?.dir === "desc" ? "desc" : "asc";

  let query = supabase
    .from("contracts")
    .select("*, plan:membership_plans(name, code, monthly_amount), customer:customers(full_name, email)", { count: "exact" });
  // 並び替え指定が無い場合は従来どおり契約開始日の新しい順。
  if (activeSort) {
    const { column, foreignTable } = SORT_COLUMNS[activeSort];
    query = query.order(column, { ascending: activeDir === "asc", foreignTable, nullsFirst: false });
  } else {
    query = query.order("started_at", { ascending: false });
  }
  if (status) query = query.eq("status", status);

  // Search across the whole table (customer name/email + plan name), not just
  // the current page: resolve matching ids in the joined tables, then filter.
  if (q) {
    const [custIds, planIds] = await Promise.all([
      resolveMatchingIds(supabase, "customers", ["full_name", "email"], q),
      resolveMatchingIds(supabase, "membership_plans", ["name"], q),
    ]);
    const orParts: string[] = [];
    if (custIds.length) orParts.push(`customer_id.in.(${custIds.join(",")})`);
    if (planIds.length) orParts.push(`plan_id.in.(${planIds.join(",")})`);
    query = orParts.length ? query.or(orParts.join(",")) : query.eq("id", NO_MATCH_ID);
  }

  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);
  const rows = (data as any[]) ?? [];

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  // 列見出しクリック用のリンク。同じ列を再クリックすると昇順⇄降順を切り替える。
  const sortHref = (key: SortKey) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (status) qs.set("status", status);
    qs.set("sort", key);
    qs.set("dir", activeSort === key && activeDir === "asc" ? "desc" : "asc");
    return `/admin/contracts?${qs.toString()}`;
  };
  const sortIndicator = (key: SortKey) => (activeSort === key ? (activeDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">契約一覧</h1>
        <span className="text-sm text-ink-soft">全 {count ?? 0} 件</span>
      </div>

      <form className="card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="label">氏名／メール／プラン</label>
          <input name="q" className="input" defaultValue={q} placeholder="検索..." />
        </div>
        <div>
          <label className="label">状態</label>
          <select name="status" className="input" defaultValue={status}>
            <option value="">すべて</option>
            <option value="active">有効</option>
            <option value="past_due">決済失敗</option>
            <option value="canceled">停止</option>
            <option value="paused">一時停止</option>
            <option value="incomplete">手続き中</option>
          </select>
        </div>
        <button className="btn-primary">絞り込む</button>
        {(q || status) && (
          <Link className="btn-ghost" href="/admin/contracts">
            リセット
          </Link>
        )}
      </form>

      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th><Link href={sortHref("customer")} className="hover:underline whitespace-nowrap">顧客{sortIndicator("customer")}</Link></th>
              <th><Link href={sortHref("plan")} className="hover:underline whitespace-nowrap">プラン{sortIndicator("plan")}</Link></th>
              <th><Link href={sortHref("monthly")} className="hover:underline whitespace-nowrap">月額{sortIndicator("monthly")}</Link></th>
              <th><Link href={sortHref("status")} className="hover:underline whitespace-nowrap">状態{sortIndicator("status")}</Link></th>
              <th><Link href={sortHref("started")} className="hover:underline whitespace-nowrap">開始{sortIndicator("started")}</Link></th>
              <th><Link href={sortHref("period_end")} className="hover:underline whitespace-nowrap">次回決済{sortIndicator("period_end")}</Link></th>
              <th>停止</th>
              <th>Stripe</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c: any, i: number) => (
              <ContractRow
                key={c.id}
                index={from + i + 1}
                contract={{
                  id: c.id,
                  customer_id: c.customer_id,
                  plan_id: c.plan_id,
                  status: c.status,
                  started_at: formatDate(c.started_at),
                  current_period_end: c.current_period_end ?? null,
                  canceled_at: c.canceled_at ? formatDate(c.canceled_at) : "—",
                  stripe_subscription_id: c.stripe_subscription_id ?? null,
                  customer_name: c.customer?.full_name ?? "—",
                  customer_email: c.customer?.email ?? "",
                  plan_name: c.plan?.name ?? "—",
                  monthly_yen: formatYen(c.plan?.monthly_amount ?? 0),
                  status_label: statusLabel(c.status),
                }}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-6 text-ink-mute">
                  該当する契約がありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/admin/contracts?page=${p}${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${activeSort ? `&sort=${activeSort}&dir=${activeDir}` : ""}`}
              className={`px-3 py-1 rounded-lg border ${p === page ? "bg-brand text-white border-brand" : "border-surface-line"}`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
