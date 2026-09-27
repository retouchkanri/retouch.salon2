import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { communityInstalled } from "@/lib/community/admin";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatDate } from "@/lib/format";
import { isHiddenAccountEmail } from "@/lib/hiddenAccounts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import CommunityTabs from "../CommunityTabs";
import BanControls from "./BanControls";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const FILTERS = [
  { key: "all", label: "すべて" },
  { key: "joined", label: "参加したことがある" },
  { key: "never", label: "未参加" },
  { key: "banned", label: "利用停止中" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export default async function CommunityUsersPage({
  searchParams,
}: {
  searchParams: { q?: string; filter?: string; page?: string };
}) {
  await requireCapability("community.manage");
  const admin = createSupabaseAdminClient();
  const installed = await communityInstalled(admin);
  if (!installed.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">コミュニティ管理：ユーザー</h1>
        <p className="card text-sm">community.sql が未適用です。<Link href="/admin/community" className="text-brand underline ml-1">概要へ</Link></p>
      </div>
    );
  }

  const q = (searchParams.q ?? "").trim();
  const filter: FilterKey = (FILTERS.find((f) => f.key === searchParams.filter)?.key ?? "all") as FilterKey;
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const nowIso = new Date().toISOString();

  const [customersRes, profilesRes, bansRes, statsRes, staffRes, reportsOpen] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      admin
        .from("customers")
        .select("id, auth_user_id, full_name, full_name_kana, email, username, status, registration_completed")
        .not("auth_user_id", "is", null)
        .order("full_name")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<any>((from, to) =>
      admin.from("community_profiles").select("user_id, display_name, setup_done, allow_dm, last_seen_at").order("user_id").range(from, to),
    ),
    admin.from("community_bans").select("user_id, reason, until, created_at"),
    admin.rpc("community_admin_user_stats"),
    admin.from("profiles").select("id").in("role", ["owner", "admin", "moderator"]),
    admin.from("community_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const profiles = new Map<string, any>(profilesRes.rows.map((p) => [p.user_id, p]));
  const bans = new Map<string, any>(
    ((bansRes.data ?? []) as any[]).filter((b) => !b.until || b.until > nowIso).map((b) => [b.user_id, b]),
  );
  const stats = new Map<string, any>(((statsRes.data ?? []) as any[]).map((s) => [s.user_id, s]));
  const staffIds = new Set(((staffRes.data ?? []) as any[]).map((s) => s.id));

  const all = customersRes.rows
    .filter((c) => !staffIds.has(c.auth_user_id) && !isHiddenAccountEmail(c.email))
    .map((c) => {
      const p = profiles.get(c.auth_user_id);
      const s = stats.get(c.auth_user_id);
      return {
        userId: c.auth_user_id as string,
        customerId: c.id as string,
        fullName: (c.full_name as string | null) ?? "",
        kana: (c.full_name_kana as string | null) ?? "",
        email: (c.email as string | null) ?? "",
        username: (c.username as string | null) ?? "",
        status: c.status as string,
        registered: c.registration_completed !== false,
        displayName: (p?.display_name as string | null) ?? null,
        setupDone: !!p?.setup_done,
        allowDm: p ? !!p.allow_dm : true,
        lastSeen: (p?.last_seen_at as string | null) ?? null,
        messages: Number(s?.message_count ?? 0),
        lastMessage: (s?.last_message_at as string | null) ?? null,
        ban: bans.get(c.auth_user_id) ?? null,
      };
    });

  const needle = q.toLowerCase();
  const filtered = all
    .filter((u) => {
      if (filter === "joined" && !u.lastSeen) return false;
      if (filter === "never" && u.lastSeen) return false;
      if (filter === "banned" && !u.ban) return false;
      if (!needle) return true;
      return [u.fullName, u.kana, u.email, u.username, u.displayName ?? ""].some((s) => s.toLowerCase().includes(needle));
    })
    .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.fullName.localeCompare(b.fullName, "ja"));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const qs = (p: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (filter !== "all") s.set("filter", filter);
    if (p > 1) s.set("page", String(p));
    const str = s.toString();
    return str ? `?${str}` : "";
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <h1 className="text-2xl font-bold">コミュニティ管理：ユーザー</h1>
      <CommunityTabs openReports={reportsOpen.count ?? 0} />

      <form className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="label" htmlFor="u-q">
            検索（氏名・フリガナ・メール・ユーザーネーム・表示名）
          </label>
          <input id="u-q" name="q" className="input" defaultValue={q} />
        </div>
        <div>
          <label className="label" htmlFor="u-filter">
            絞り込み
          </label>
          <select id="u-filter" name="filter" className="input" defaultValue={filter}>
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary !px-5 !py-3" type="submit">
          検索
        </button>
      </form>

      <p className="text-sm text-ink-soft">
        {filtered.length.toLocaleString("ja-JP")}人（ログイン可能な会員。運営アカウントは除く）
      </p>

      <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>氏名</th>
              <th>コミュニティ表示名</th>
              <th>最終訪問</th>
              <th className="text-right">投稿数</th>
              <th>最終投稿</th>
              <th>状態</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-ink-mute py-6">
                  該当するユーザーがいません。
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const usable = u.status === "active" && u.registered;
              return (
                <tr key={u.userId}>
                  <td>
                    <Link href={`/admin/customers/${u.customerId}`} className="font-semibold text-brand underline">
                      {u.fullName || "（氏名なし）"}
                    </Link>
                    <p className="text-xs text-ink-mute">{u.email}</p>
                  </td>
                  <td>
                    {u.displayName ?? <span className="text-ink-mute">未設定</span>}
                    {u.displayName && !u.setupDone && <span className="ml-1 text-[11px] text-ink-mute">（自動）</span>}
                    {!u.allowDm && <p className="text-[11px] text-ink-mute">会員からのDM: 受け付けない</p>}
                  </td>
                  <td className="text-xs whitespace-nowrap">{u.lastSeen ? formatDate(u.lastSeen, true) : "—"}</td>
                  <td className="text-right tabular-nums">{u.messages}</td>
                  <td className="text-xs whitespace-nowrap">{u.lastMessage ? formatDate(u.lastMessage, true) : "—"}</td>
                  <td className="text-xs">
                    {u.ban ? (
                      <span className="chip-error">
                        停止中{u.ban.until ? `（${formatDate(u.ban.until)}まで）` : "（無期限）"}
                      </span>
                    ) : !usable ? (
                      <span className="chip-mute">{u.status === "active" ? "登録手続き中" : u.status === "withdrawn" ? "退会" : "会員停止中"}</span>
                    ) : (
                      <span className="chip-ok">利用可</span>
                    )}
                    {u.ban?.reason && <p className="text-[11px] text-ink-mute mt-1">理由: {u.ban.reason}</p>}
                  </td>
                  <td className="col-actions whitespace-nowrap space-y-1">
                    {usable && !u.ban && (
                      <Link href={`/community?dm=${u.userId}`} target="_blank" rel="noopener" className="block text-brand underline text-sm">
                        DMを送る
                      </Link>
                    )}
                    <BanControls userId={u.userId} banned={!!u.ban} name={u.fullName || u.displayName || "この会員"} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center gap-3 text-sm">
          {current > 1 && (
            <Link href={`/admin/community/users${qs(current - 1)}`} className="text-brand underline">
              ← 前へ
            </Link>
          )}
          <span>
            {current} / {totalPages}
          </span>
          {current < totalPages && (
            <Link href={`/admin/community/users${qs(current + 1)}`} className="text-brand underline">
              次へ →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
