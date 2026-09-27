import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { donationMethodLabel, formatDate, formatYen, memberClassLabel, statusLabel } from "@/lib/format";
import { resolveMatchingIds, sanitizeSearch } from "@/lib/adminSearch";
import DonationRow from "./DonationRow";
import DonationForm from "./DonationForm";

const PAGE_SIZE = 50;

export default async function AdminDonationsPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string; page?: string; member?: string };
}) {
  const supabase = createSupabaseServerClient();
  const status = searchParams?.status ?? "";
  // 会員寄付（会員＝支援契約あり）と、会員以外の単発支援を分けて表示する。
  const member = searchParams?.member === "member" || searchParams?.member === "single"
    ? searchParams.member
    : "";
  const q = (searchParams?.q ?? "").trim();
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;

  // 会員判定は「契約(contracts)を持つ顧客の寄付」かどうかで行う。
  //  - member : 契約を持つ顧客の寄付のみ（INNER JOIN）
  //  - single : 顧客はいるが契約がない＝単発支援（左結合 + contracts が空）
  const selectCols =
    member === "member"
      ? "*, customer:customers!inner(full_name, email, contracts!inner(id))"
      : member === "single"
        ? "*, customer:customers!inner(full_name, email, contracts(id))"
        : "*, customer:customers(full_name, email)";

  let query = supabase
    .from("donations")
    .select(selectCols, { count: "exact" })
    .order("donated_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (member === "single") query = query.is("customer.contracts", null);

  // Search the whole table, not just the current page: donor fields live on the
  // donation row; the member's name/email live on the joined customer, so we
  // resolve matching customer ids and OR them in.
  if (q) {
    const safe = sanitizeSearch(q);
    const custIds = await resolveMatchingIds(supabase, "customers", ["full_name", "email"], q);
    const orParts = [
      `donor_name.ilike.*${safe}*`,
      `donor_email.ilike.*${safe}*`,
      `message.ilike.*${safe}*`,
    ];
    if (custIds.length) orParts.push(`customer_id.in.(${custIds.join(",")})`);
    query = query.or(orParts.join(","));
  }

  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);
  const rows = (data as any[]) ?? [];

  // Per-row 会員/単発 badge + 会員種別（アテンダー／メンバーズ／サポーター／リェリーフ 等）
  const pageCustomerIds = [...new Set(rows.map((d) => d.customer_id).filter(Boolean))] as string[];
  const memberSet = new Set<string>();
  const memberTypeByCustomer = new Map<string, string>();
  if (pageCustomerIds.length) {
    const [{ data: mem }, { data: summaries }] = await Promise.all([
      supabase.from("contracts").select("customer_id").in("customer_id", pageCustomerIds),
      supabase
        .from("v_customer_summary")
        .select("customer_id, primary_plan_name, member_class_code")
        .in("customer_id", pageCustomerIds),
    ]);
    for (const m of mem ?? []) if ((m as any).customer_id) memberSet.add((m as any).customer_id);
    for (const s of summaries ?? []) {
      const label =
        (s as any).primary_plan_name ??
        ((s as any).member_class_code ? memberClassLabel((s as any).member_class_code) : null);
      if ((s as any).customer_id && label) memberTypeByCustomer.set((s as any).customer_id, label);
    }
  }

  const total = rows.reduce(
    (acc: number, d: any) => (d.status === "succeeded" ? acc + Number(d.amount ?? 0) : acc),
    0,
  );
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">寄付一覧</h1>
        <div className="text-sm text-ink-soft">
          全 {count ?? 0} 件 / 成功合計（表示範囲） {formatYen(total)}
        </div>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">＋ 手動で寄付を追加</summary>
        <div className="mt-3">
          <DonationForm />
        </div>
      </details>

      <form className="card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="label">検索</label>
          <input name="q" className="input" defaultValue={q} placeholder="氏名、メール、メッセージ..." />
        </div>
        <div>
          <label className="label">状態</label>
          <select name="status" className="input" defaultValue={status}>
            <option value="">すべて</option>
            <option value="succeeded">成功</option>
            <option value="pending">保留</option>
            <option value="failed">失敗</option>
            <option value="refunded">返金済</option>
          </select>
        </div>
        <div>
          <label className="label">区分</label>
          <select name="member" className="input" defaultValue={member}>
            <option value="">すべて</option>
            <option value="member">会員の寄付</option>
            <option value="single">単発・非会員</option>
          </select>
        </div>
        <button className="btn-primary">絞り込む</button>
        {(q || status || member) && (
          <Link className="btn-ghost" href="/admin/donations">
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
              <th>寄付者</th>
              <th>会員種別</th>
              <th>金額</th>
              <th>状態</th>
              <th>支払方法</th>
              <th>入金確認日</th>
              <th>メッセージ</th>
              <th>備考</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d: any, i: number) => (
              <DonationRow
                key={d.id}
                index={from + i + 1}
                donation={{
                  id: d.id,
                  customer_id: d.customer_id,
                  customer_name: d.customer?.full_name ?? "",
                  customer_email: d.customer?.email ?? "",
                  donor_name: d.donor_name ?? "",
                  donor_email: d.donor_email ?? "",
                  amount: Number(d.amount ?? 0),
                  amount_label: formatYen(d.amount),
                  status: d.status,
                  status_label: statusLabel(d.status),
                  message: d.message ?? "",
                  payment_method: d.payment_method ?? "card",
                  payment_method_label: donationMethodLabel(d.payment_method),
                  confirmed_at_label: d.confirmed_at ? formatDate(d.confirmed_at) : "",
                  confirmed_at_value: d.confirmed_at ? String(d.confirmed_at).slice(0, 10) : "",
                  note: d.note ?? "",
                  donated_at: formatDate(d.donated_at, true),
                  donated_at_value: d.donated_at ? String(d.donated_at).slice(0, 10) : "",
                  is_member: !!d.customer_id && memberSet.has(d.customer_id),
                  member_type_label: d.customer_id
                    ? memberTypeByCustomer.get(d.customer_id) ?? null
                    : null,
                }}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-6 text-ink-mute">
                  該当する寄付がありません。
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
            if (member) qs.set("member", member);
            if (q) qs.set("q", q);
            qs.set("page", String(n));
            return (
              <Link
                key={n}
                href={`/admin/donations?${qs.toString()}`}
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
