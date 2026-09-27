import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatUnits, formatYen, statusLabel } from "@/lib/format";
import { NO_MATCH_ID, resolveMatchingIds } from "@/lib/adminSearch";
import { getSession } from "@/lib/auth";
import { fetchAllRows } from "@/lib/fetchAll";
import { can } from "@/lib/roles";
import SupportRow from "./SupportRow";
import SupportForm from "./SupportForm";
import HorseSupportStatus from "./HorseSupportStatus";

const PAGE_SIZE = 50;

export default async function AdminSupportsPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string; horse?: string; page?: string };
}) {
  const supabase = createSupabaseServerClient();
  const session = await getSession();
  const canManageHorses = !!session && can(session.role, "horses.manage");
  const status = searchParams?.status ?? "";
  const q = (searchParams?.q ?? "").trim();
  const horse = searchParams?.horse ?? "";
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;

  // 馬ごとの口数・金額は全件の合計。素のクエリは PostgREST の 1000 行上限で
  // 黙って打ち切られ、集計が過少になるためページングする。
  const [{ data: horses }, { rows: horseStats }] = await Promise.all([
    supabase.from("horses").select("id, name, image_url").order("sort_order"),
    fetchAllRows<any>((from, to) =>
      supabase
        .from("support_subscriptions")
        .select("horse_id, units, monthly_amount, status, horse:horses(name, image_url)")
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  let query = supabase
    .from("support_subscriptions")
    .select(
      "*, customer:customers(full_name, email), horse:horses(name)",
      { count: "exact" },
    )
    .order("started_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (horse) query = query.eq("horse_id", horse);

  // Search the whole table (customer name/email + horse name), not just the
  // current page: resolve matching ids in the joined tables, then filter.
  if (q) {
    const [custIds, horseIds] = await Promise.all([
      resolveMatchingIds(supabase, "customers", ["full_name", "email"], q),
      resolveMatchingIds(supabase, "horses", ["name"], q),
    ]);
    const orParts: string[] = [];
    if (custIds.length) orParts.push(`customer_id.in.(${custIds.join(",")})`);
    if (horseIds.length) orParts.push(`horse_id.in.(${horseIds.join(",")})`);
    query = orParts.length ? query.or(orParts.join(",")) : query.eq("id", NO_MATCH_ID);
  }

  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);
  const rows = (data as any[]) ?? [];

  // horse-wise visualization
  const stats = new Map<string, { name: string; image_url: string | null; units: number; monthly: number; supporters: number }>();
  for (const r of horseStats) {
    const id = (r as any).horse_id as string;
    const name = (r as any).horse?.name ?? "—";
    const image_url = (r as any).horse?.image_url ?? null;
    const cur = stats.get(id) ?? { name, image_url, units: 0, monthly: 0, supporters: 0 };
    cur.units += Number((r as any).units ?? 0);
    cur.monthly += Number((r as any).monthly_amount ?? 0);
    cur.supporters += 1;
    stats.set(id, cur);
  }
  const horseSummary = Array.from(stats.entries()).sort((a, b) => b[1].monthly - a[1].monthly);
  const horseStatusItems = horseSummary.map(([id, s]) => ({
    id,
    name: s.name,
    image_url: s.image_url,
    stats: `支援者 ${s.supporters}名 / ${formatUnits(s.units)} / ${formatYen(s.monthly)}月`,
  }));

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">支援管理</h1>
        <span className="text-sm text-ink-soft">全 {count ?? 0} 件</span>
      </div>

      <div className="card border-2 border-brand/20 bg-brand-50/30">
        <h2 className="section-title mb-2">公開ページ：1口支援制度のご案内</h2>
        <p className="text-sm text-ink-soft mb-3 leading-relaxed">
          半口支援・8口達成・支援特典・譲渡条件などを、一般公開ページで事前にご案内しています。
        </p>
        <Link href="/support-guide" target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex">
          /support-guide をプレビュー
        </Link>
      </div>

      {/* 馬ごとの支援状況（画像・名称の編集 / 追加 / 削除つき） */}
      <HorseSupportStatus items={horseStatusItems} canManage={canManageHorses} />

      <details className="card">
        <summary className="cursor-pointer font-semibold">＋ 手動で支援を追加</summary>
        <div className="mt-3">
          <SupportForm horses={(horses as any[]) ?? []} />
        </div>
      </details>

      <form className="card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="label">顧客／メール</label>
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
          </select>
        </div>
        <div>
          <label className="label">馬</label>
          <select name="horse" className="input" defaultValue={horse}>
            <option value="">すべて</option>
            {(horses as any[] | null)?.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary">絞り込む</button>
        {(q || status || horse) && (
          <Link className="btn-ghost" href="/admin/supports">
            リセット
          </Link>
        )}
      </form>

      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>顧客</th>
              <th>馬</th>
              <th>口数</th>
              <th>月額</th>
              <th>状態</th>
              <th>開始</th>
              <th>停止</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s: any, i: number) => (
              <SupportRow
                key={s.id}
                index={from + i + 1}
                support={{
                  id: s.id,
                  customer_id: s.customer_id,
                  customer_name: s.customer?.full_name ?? "—",
                  customer_email: s.customer?.email ?? "",
                  horse_name: s.horse?.name ?? "—",
                  units: Number(s.units ?? 0),
                  units_label: formatUnits(s.units),
                  monthly_amount: Number(s.monthly_amount ?? 0),
                  monthly_label: formatYen(s.monthly_amount),
                  status: s.status,
                  status_label: statusLabel(s.status),
                  started_at: formatDate(s.started_at),
                  canceled_at: s.canceled_at ? formatDate(s.canceled_at) : "—",
                }}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-6 text-ink-mute">
                  該当する支援がありません。
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
            if (status) qs.set("status", status);
            if (horse) qs.set("horse", horse);
            if (q) qs.set("q", q);
            qs.set("page", String(n));
            return (
              <Link
                key={n}
                href={`/admin/supports?${qs.toString()}`}
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
