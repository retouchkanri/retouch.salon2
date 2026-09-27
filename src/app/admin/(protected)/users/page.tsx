import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCapability } from "@/lib/auth";
import { resolveAvatarUrl } from "@/lib/avatars";
import { formatDate } from "@/lib/format";
import {
  ROLE_LABELS_JP,
  ROLES,
  canManageRole,
  resolveBadge,
  toRole,
  type Badge,
  type Role,
} from "@/lib/roles";
import { loadPaymentStats } from "@/lib/badge";
import { fetchAllByIds, fetchAllRows } from "@/lib/fetchAll";
import { isHiddenAccountEmail } from "@/lib/hiddenAccounts";
import RoleBadge from "@/components/RoleBadge";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  badge: Badge;
  customer_status: string | null;
  avatar_url: string | null;
  created_at: string;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { q?: string; role?: string };
}) {
  noStore();
  const session = await requireCapability("users.manage");
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const role = searchParams.role ?? "";

  const admin = createSupabaseAdminClient();

  // Source of truth: every login account has a `profiles` row (created on
  // signup and on admin-create). Reading directly from the DB tables
  // reflects live state and avoids stale auth-admin listing.
  // 登録ユーザー数をそのまま表示するので、1000 行上限で切られないよう全件取得する。
  const { rows: profiles } = await fetchAllRows<any>((from, to) =>
    admin
      .from("profiles")
      .select("id, role, customer_id, created_at")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const customerIds = profiles
    .map((p: any) => p.customer_id)
    .filter((id: string | null): id is string => !!id);
  const { rows: customers } = await fetchAllByIds<any>(customerIds, (chunk, from, to) =>
    admin
      .from("customers")
      .select("id, full_name, email, status, avatar_url, joined_at, created_at")
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const customerMap = new Map<string, any>(customers.map((c: any) => [c.id, c]));

  // Succeeded-payment stats (first payment + total paid) drive the member badge.
  const payStats = await loadPaymentStats(admin, customerIds);

  // Customers holding an RPT (RetouchPony【リタポ】) contract — forced gold badge.
  const rptCustomerIds = new Set<string>();
  if (customerIds.length) {
    const { rows: rptRows } = await fetchAllByIds<any>(customerIds, (chunk, from, to) =>
      admin
        .from("contracts")
        .select("id, customer_id, membership_plans!inner(code)")
        .in("customer_id", chunk)
        .eq("membership_plans.code", "RPT")
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const r of rptRows) rptCustomerIds.add((r as any).customer_id);
  }

  // Fill in emails for any profile whose customer row lacks one, using the
  // auth record as a fallback (best-effort; never throws).
  const emailFallback = new Map<string, string>();
  try {
    // listUsers は 1 ページ最大 1000 件。1 ページ目だけ見ると 1001 人目以降の
    // メールが埋まらないので、空ページに当たるまで辿る。
    const perPage = 1000;
    for (let page = 1; ; page += 1) {
      const { data: authPage } = await admin.auth.admin.listUsers({ page, perPage });
      const users = authPage?.users ?? [];
      for (const u of users) {
        if (u.email) emailFallback.set(u.id, u.email);
      }
      if (users.length < perPage) break;
    }
  } catch {
    // ignore — customers.email is the primary source
  }

  const rows: Row[] = profiles.map((p: any) => {
    const cust = p.customer_id ? customerMap.get(p.customer_id) : null;
    const r = toRole(p.role);
    const hasRpt = !!p.customer_id && rptCustomerIds.has(p.customer_id);
    const stat = p.customer_id ? payStats.get(p.customer_id) : undefined;
    const badge = resolveBadge(r, {
      registeredAt: cust?.joined_at ?? cust?.created_at ?? p.created_at ?? null,
      firstPaymentAt: stat?.firstPaymentAt ?? null,
      totalPaidYen: stat?.totalPaidYen ?? 0,
      hasActiveRpt: hasRpt,
    });
    return {
      id: p.id,
      email: cust?.email ?? emailFallback.get(p.id) ?? "",
      full_name: cust?.full_name ?? null,
      role: r,
      badge,
      customer_status: cust?.status ?? null,
      avatar_url: cust?.avatar_url ?? null,
      created_at: p.created_at,
    };
  })
    // 内部テスト用アカウントは一覧・件数から除外（Supabase 上には存在する）。
    .filter((r) => !isHiddenAccountEmail(r.email));

  const filtered = rows.filter((r) => {
    if (role && r.role !== role) return false;
    if (!q) return true;
    return (
      r.email.toLowerCase().includes(q) ||
      (r.full_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ユーザー管理</h1>
          <p className="text-sm text-ink-mute mt-1">
            登録ユーザー 全 {rows.length} 名
            {(role || q) && <> / 表示中 {filtered.length} 名（絞り込み適用中）</>}
          </p>
        </div>
        <Link href="/admin/users/new" className="btn-primary !py-2 !px-4">
          新規ユーザー追加
        </Link>
      </div>

      <form method="get" className="card grid md:grid-cols-4 gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="メール / 氏名で検索"
          className="input md:col-span-2"
        />
        <select name="role" defaultValue={role} className="input">
          <option value="">権限：すべて</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS_JP[r]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary !py-2 !px-4">絞り込む</button>
          <Link href="/admin/users" className="btn-ghost !py-2 !px-4">リセット</Link>
        </div>
      </form>

      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th></th>
              <th>氏名</th>
              <th>メール</th>
              <th>権限</th>
              <th>バッジ</th>
              <th>状態</th>
              <th>登録日</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const avatarSrc = resolveAvatarUrl(r.role, r.avatar_url);
              return (
              <tr key={r.id} className="hover:bg-surface-soft">
                <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                <td>
                  {avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarSrc}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover border border-surface-line"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-surface-soft border border-surface-line" />
                  )}
                </td>
                <td className="font-semibold">{r.full_name ?? "—"}</td>
                <td>{r.email}</td>
                <td>
                  <span className="chip-mute">{ROLE_LABELS_JP[r.role]}</span>
                </td>
                <td>
                  <RoleBadge badge={r.badge} />
                </td>
                <td>{r.customer_status ?? "—"}</td>
                <td>{formatDate(r.created_at)}</td>
                <td className="text-right">
                  {canManageRole(session.role, r.role) ? (
                    <Link href={`/admin/users/${r.id}`} className="text-brand underline">
                      編集
                    </Link>
                  ) : (
                    <span className="text-ink-mute text-xs">権限外</span>
                  )}
                </td>
              </tr>
            );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-ink-mute py-6">
                  {rows.length > 0 ? (
                    <>
                      絞り込み条件に一致するユーザーがいません（登録は全 {rows.length} 名）。
                      <Link href="/admin/users" className="text-brand underline ml-1">条件をリセット</Link>
                    </>
                  ) : (
                    "ユーザーがいません。"
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
