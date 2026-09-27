import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { communityInstalled } from "@/lib/community/admin";
import { plainText } from "@/lib/community/text";
import { formatDate } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import CommunityTabs from "../CommunityTabs";
import ReportActions from "./ReportActions";

export const dynamic = "force-dynamic";

const STATUS_LABELS = { open: "未対応", resolved: "対応済み", dismissed: "問題なし" } as const;

export default async function CommunityReportsPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireCapability("community.manage");
  const admin = createSupabaseAdminClient();
  const installed = await communityInstalled(admin);
  if (!installed.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">コミュニティ管理：通報</h1>
        <p className="card text-sm">community.sql が未適用です。<Link href="/admin/community" className="text-brand underline ml-1">概要へ</Link></p>
      </div>
    );
  }

  const showAll = searchParams.status === "all";
  let query = admin.from("community_reports").select("*").order("created_at", { ascending: false }).limit(200);
  if (!showAll) query = query.eq("status", "open");
  const [{ data: reports, error }, openCount] = await Promise.all([
    query,
    admin.from("community_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  const list = (reports ?? []) as any[];

  const userIds = Array.from(new Set(list.flatMap((r) => [r.reporter_id, r.reported_user_id]).filter(Boolean))) as string[];
  const channelIds = Array.from(new Set(list.map((r) => r.channel_id).filter(Boolean))) as string[];
  const messageIds = Array.from(new Set(list.map((r) => r.message_id).filter(Boolean))) as string[];
  const [{ data: customers }, { data: cprofiles }, { data: channels }, { data: messages }] = await Promise.all([
    userIds.length ? admin.from("customers").select("id, auth_user_id, full_name, email").in("auth_user_id", userIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length ? admin.from("community_profiles").select("user_id, display_name").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
    channelIds.length ? admin.from("community_channels").select("id, kind, name").in("id", channelIds) : Promise.resolve({ data: [] as any[] }),
    messageIds.length ? admin.from("community_messages").select("id, deleted_at, parent_id").in("id", messageIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const custMap = new Map((customers ?? []).map((c: any) => [c.auth_user_id, c]));
  const profMap = new Map((cprofiles ?? []).map((p: any) => [p.user_id, p.display_name as string | null]));
  const chMap = new Map((channels ?? []).map((c: any) => [c.id, c]));
  const msgMap = new Map((messages ?? []).map((m: any) => [m.id, m]));

  const who = (id: string | null) => {
    if (!id) return <span className="text-ink-mute">（退会したユーザー）</span>;
    const c = custMap.get(id);
    const d = profMap.get(id);
    return (
      <span>
        {c ? (
          <Link href={`/admin/customers/${c.id}`} className="text-brand underline">
            {c.full_name ?? c.email}
          </Link>
        ) : (
          "運営スタッフ"
        )}
        {d && <span className="text-ink-mute">（表示名: {d}）</span>}
      </span>
    );
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold">コミュニティ管理：通報</h1>
      <CommunityTabs openReports={openCount.count ?? 0} />
      <div className="flex gap-3 text-sm">
        <Link href="/admin/community/reports" className={showAll ? "text-brand underline" : "font-bold"}>
          未対応のみ
        </Link>
        <Link href="/admin/community/reports?status=all" className={showAll ? "font-bold" : "text-brand underline"}>
          すべて（最新200件）
        </Link>
      </div>
      {error && <p className="text-sm text-danger">{error.message}</p>}
      {list.length === 0 && <p className="card text-sm text-ink-mute text-center">{showAll ? "通報はありません。" : "未対応の通報はありません。"}</p>}
      <div className="space-y-3">
        {list.map((r) => {
          const ch = chMap.get(r.channel_id);
          const msg = msgMap.get(r.message_id);
          const deleted = !msg || !!msg.deleted_at;
          const where = !ch ? "（削除されたチャンネル）" : ch.kind === "dm" ? "ダイレクトメッセージ" : `#${ch.name}`;
          return (
            <div key={r.id} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={r.status === "open" ? "chip-error" : r.status === "resolved" ? "chip-ok" : "chip-mute"}>
                  {STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status}
                </span>
                <span className="text-ink-mute">{formatDate(r.created_at, true)}</span>
                <span className="text-ink-soft">{where}</span>
                {msg?.parent_id && <span className="text-xs text-ink-mute">（スレッド返信）</span>}
              </div>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-mute">投稿者</dt>
                <dd>{who(r.reported_user_id)}</dd>
                <dt className="text-ink-mute">通報者</dt>
                <dd>{who(r.reporter_id)}</dd>
                <dt className="text-ink-mute">理由</dt>
                <dd className="whitespace-pre-wrap">{r.reason}</dd>
              </dl>
              <div className="rounded border border-surface-line bg-surface-soft p-3 text-sm">
                <p className="text-xs text-ink-mute mb-1">通報時のメッセージ{deleted && "（現在は削除済み）"}</p>
                <p className="whitespace-pre-wrap">{plainText(r.message_body ?? "", () => "会員", 2000) || "（本文なし・添付ファイルのみ）"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ReportActions reportId={r.id} status={r.status} messageId={r.message_id} messageDeleted={deleted} />
                {r.reported_user_id && custMap.get(r.reported_user_id)?.email && (
                  <Link
                    href={`/admin/community/users?q=${encodeURIComponent(custMap.get(r.reported_user_id)?.email ?? "")}`}
                    className="text-xs text-brand underline"
                  >
                    投稿者の利用停止へ
                  </Link>
                )}
                {ch && ch.kind === "channel" && msg && !deleted && (
                  <Link href={`/community?c=${ch.id}&m=${msg.parent_id ?? msg.id}`} target="_blank" rel="noopener" className="text-xs text-brand underline">
                    コミュニティで見る ↗
                  </Link>
                )}
              </div>
              {r.resolved_at && <p className="text-xs text-ink-mute">処理日時: {formatDate(r.resolved_at, true)}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
