import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { communityInstalled } from "@/lib/community/admin";
import {
  CATEGORY_LABELS,
  CHANNEL_GROUPS,
  channelGroupOf,
  describeAudience,
  type ChannelCategory,
} from "@/lib/community/constants";
import { plainText } from "@/lib/community/text";
import { formatDate } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import AutoRefresh from "./AutoRefresh";
import { ChannelThumb } from "./channels/ChannelImage";
import CommunityTabs from "./CommunityTabs";
import HorseChannelsButton from "./HorseChannelsButton";

export const dynamic = "force-dynamic";

function jstDayStartIso(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600_000).toISOString();
}

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="rounded-lg border border-surface-line bg-surface-soft px-4 py-3">
      <p className="text-xs text-ink-mute">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="text-[11px] text-ink-mute">{note}</p>}
    </div>
  );
}

export default async function CommunityAdminPage() {
  await requireCapability("community.manage");
  const admin = createSupabaseAdminClient();
  const installed = await communityInstalled(admin);

  if (!installed.ok) {
    return (
      <div className="space-y-4 max-w-4xl">
        <h1 className="text-2xl font-bold">コミュニティ管理</h1>
        <section className="card space-y-3">
          <p className="chip-warn">未導入</p>
          <p className="font-semibold">コミュニティ用のデータベースがまだ作成されていません。</p>
          <ol className="list-decimal pl-5 text-sm space-y-1 text-ink-soft">
            <li>Supabase ダッシュボード → SQL Editor を開きます。</li>
            <li>
              リポジトリの <code className="bg-surface-soft px-1 rounded">supabase/community.sql</code> の全文を貼り付けて「Run」を押します（何度実行しても安全です）。
            </li>
            <li>この画面を再読み込みします（会員はすぐにコミュニティを利用できます）。</li>
          </ol>
          <p className="text-xs text-ink-mute">詳細: {installed.error}</p>
        </section>
      </div>
    );
  }

  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const today = jstDayStartIso(now);
  const head = { count: "exact" as const, head: true };

  const [
    channelsRes,
    statsRes,
    horsesRes,
    msgTotal,
    msgToday,
    msg7,
    dmCount,
    profiles,
    visitors7,
    reportsOpen,
    bansActive,
    userStats,
    recentRes,
  ] = await Promise.all([
    admin
      .from("community_channels")
      .select("id, name, icon, category, visibility, audience, audience_plan_codes, audience_horse_ids, post_policy, auto_join, is_required, sort_order, is_archived, is_hidden, created_by")
      .eq("kind", "channel")
      .order("sort_order")
      .order("name"),
    admin.rpc("community_admin_channel_stats"),
    admin.from("horses").select("id, name"),
    admin.from("community_messages").select("id", head).is("deleted_at", null),
    admin.from("community_messages").select("id", head).is("deleted_at", null).gte("created_at", today),
    admin.from("community_messages").select("id", head).is("deleted_at", null).gte("created_at", since7),
    admin.from("community_channels").select("id", head).eq("kind", "dm"),
    admin.from("community_profiles").select("user_id", head),
    admin.from("community_profiles").select("user_id", head).gte("last_seen_at", since7),
    admin.from("community_reports").select("id", head).eq("status", "open"),
    admin.from("community_bans").select("user_id", head).or(`until.is.null,until.gt.${now.toISOString()}`),
    admin.rpc("community_admin_user_stats"),
    admin
      .from("community_messages")
      .select("id, channel_id, user_id, body, parent_id, attachments, created_at, community_channels!inner(kind, name)")
      .eq("community_channels.kind", "channel")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const channels = (channelsRes.data ?? []) as any[];
  // 公開チャンネル・会員チャンネル・運営チャンネル・支援馬のチャンネルの 4 グループに分ける（その他は、あるときだけ）
  const groups = CHANNEL_GROUPS.map((g) => ({ ...g, rows: channels.filter((c) => channelGroupOf(c) === g.key) })).filter(
    (g) => g.key !== "other" || g.rows.length > 0,
  );
  const stats = new Map<string, any>(((statsRes.data ?? []) as any[]).map((s) => [s.channel_id, s]));
  const horseNames = new Map<string, string>(((horsesRes.data ?? []) as any[]).map((h) => [h.id, h.name]));
  const posters7 = ((userStats.data ?? []) as any[]).filter((u) => u.last_message_at && u.last_message_at >= since7).length;
  const recent = (recentRes.data ?? []) as any[];

  const mentionIds = recent.flatMap((m) =>
    Array.from(String(m.body ?? "").matchAll(/<@([0-9a-f-]{36})>/gi), (x) => x[1].toLowerCase()),
  );
  const creatorIds = channels.map((c) => c.created_by as string | null).filter(Boolean) as string[];
  const authorIds = Array.from(new Set([...recent.map((m) => m.user_id), ...mentionIds, ...creatorIds].filter(Boolean))) as string[];
  const [{ data: authorProfiles }, { data: authorCustomers }] = await Promise.all([
    authorIds.length
      ? admin.from("community_profiles").select("user_id, display_name").in("user_id", authorIds)
      : Promise.resolve({ data: [] as any[] }),
    authorIds.length
      ? admin.from("customers").select("auth_user_id, full_name").in("auth_user_id", authorIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const displayNames = new Map((authorProfiles ?? []).map((p: any) => [p.user_id, p.display_name as string | null]));
  const realNames = new Map((authorCustomers ?? []).map((c: any) => [c.auth_user_id, c.full_name as string | null]));
  const authorLabel = (id: string | null) => {
    if (!id) return "退会したユーザー";
    const d = displayNames.get(id);
    const r = realNames.get(id);
    return d && r && d !== r ? `${d}（${r}）` : d || r || "会員";
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <AutoRefresh seconds={30} />
      <h1 className="text-2xl font-bold">コミュニティ管理</h1>
      <CommunityTabs openReports={reportsOpen.count ?? 0} />

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-lg">利用状況</h2>
          <span className="chip-ok">● 有料会員が利用できます</span>
        </div>
        <p className="text-sm text-ink-soft">
          コミュニティを利用できるのは、運営と有料会員（会員種別のある会員）だけです。会員種別のない無料会員は利用できません。
          公開チャンネルは利用できる会員全員に表示され、会員種別・支援馬のチャンネルは該当する会員だけに表示されます。
          「非表示」にしたチャンネルは、運営を含めて誰にも表示されません（編集画面でチェックを外すと元に戻ります）。
          チャンネルの作成・削除と、メンバーの追加・削除ができるのは運営だけです。
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="今日の投稿" value={msgToday.count ?? 0} />
          <Stat label="7日間の投稿" value={msg7.count ?? 0} note={`投稿した人: ${posters7}人`} />
          <Stat label="7日間の訪問者" value={visitors7.count ?? 0} note={`参加したことのある人: ${profiles.count ?? 0}人`} />
          <Stat label="累計メッセージ" value={msgTotal.count ?? 0} note={`DM の会話: ${dmCount.count ?? 0}件`} />
        </div>
        {((reportsOpen.count ?? 0) > 0 || (bansActive.count ?? 0) > 0) && (
          <p className="text-sm">
            {(reportsOpen.count ?? 0) > 0 && (
              <Link href="/admin/community/reports" className="text-danger font-semibold underline mr-4">
                未対応の通報が {reportsOpen.count} 件あります
              </Link>
            )}
            {(bansActive.count ?? 0) > 0 && <span className="text-ink-soft">利用停止中: {bansActive.count}人</span>}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-lg mr-auto">チャンネル</h2>
          <HorseChannelsButton />
          <Link href="/admin/community/channels/new" className="btn-primary !px-4 !py-2 text-sm">
            ＋ チャンネルを作成
          </Link>
        </div>
        {channels.length === 0 && (
          <p className="card text-center text-ink-mute py-6">チャンネルがありません。「＋ チャンネルを作成」から作成してください。</p>
        )}
        {groups.map((g) => (
          <details key={g.key} open className="card p-0 overflow-hidden" data-channel-group={g.key}>
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
              <span className="font-semibold">
                {g.label}（{g.rows.length}）
              </span>
              {g.rows.some((c) => c.is_hidden) && (
                <span className="text-xs font-semibold text-amber-800">うち非表示 {g.rows.filter((c) => c.is_hidden).length}</span>
              )}
              <span className="text-xs text-ink-mute">{g.note}</span>
            </summary>
            {g.rows.length === 0 ? (
              <p className="border-t border-surface-line px-4 py-4 text-sm text-ink-mute">このグループのチャンネルはありません。</p>
            ) : (
              <div className="overflow-x-auto border-t border-surface-line">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-16 text-right">順</th>
                      <th className="w-12">画像</th>
                      <th>チャンネル</th>
                      <th>表示される人</th>
                      <th>投稿</th>
                      <th className="text-right">メッセージ</th>
                      <th>最終投稿</th>
                      <th>状態</th>
                      <th className="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((c) => {
                      const s = stats.get(c.id);
                      // 会員種別・支援馬のチャンネルを「非公開（招待制）」にすると、該当する会員が自動では参加しなくなる
                      const manualOnly = c.visibility === "private" && (g.key === "member" || g.key === "horse");
                      return (
                        <tr key={c.id} className={c.is_archived || c.is_hidden ? "opacity-60" : ""}>
                          <td className="text-right tabular-nums text-ink-mute">{c.sort_order}</td>
                          <td>
                            <ChannelThumb icon={c.icon} size={32} />
                          </td>
                          <td>
                            <p className="font-semibold">{c.name}</p>
                            <p className="text-xs text-ink-mute">
                              {CATEGORY_LABELS[c.category as ChannelCategory]}
                              {c.auto_join && c.visibility === "public" && "・自動参加"}
                              {c.is_required && "・退出不可"}
                              {c.created_by && `・作成: ${authorLabel(c.created_by)}`}
                            </p>
                          </td>
                          <td className="text-xs">
                            {c.is_hidden ? "誰にも表示されません（非表示）" : describeAudience(c, (id) => horseNames.get(id))}
                            {manualOnly && !c.is_hidden && (
                              <span className="mt-0.5 block text-amber-800">
                                自動参加なし（{g.key === "member" ? "会員種別" : "支援"}に応じた自動参加は行われません。運営が追加した人だけが参加します）
                              </span>
                            )}
                          </td>
                          <td className="text-xs whitespace-nowrap">{c.post_policy === "staff" ? "運営のみ" : "誰でも"}</td>
                          <td className="text-right tabular-nums">
                            {Number(s?.message_count ?? 0).toLocaleString("ja-JP")}
                            {(c.visibility === "private" || !c.auto_join) && (
                              <span className="block text-[11px] text-ink-mute">参加 {Number(s?.member_rows ?? 0)}人</span>
                            )}
                          </td>
                          <td className="text-xs whitespace-nowrap">{s?.last_message_at ? formatDate(s.last_message_at, true) : "—"}</td>
                          <td className="whitespace-nowrap">
                            {c.is_hidden ? (
                              <span className="chip-mute">非表示</span>
                            ) : c.is_archived ? (
                              <span className="chip-mute">アーカイブ</span>
                            ) : (
                              <span className="chip-ok">表示中</span>
                            )}
                          </td>
                          <td className="col-actions whitespace-nowrap">
                            <Link href={`/admin/community/channels/${c.id}`} className="text-brand underline text-sm mr-3">
                              編集・画像
                            </Link>
                            {!c.is_hidden && (
                              <Link href={`/community?c=${c.id}`} target="_blank" rel="noopener" className="text-brand underline text-sm">
                                開く
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">最近の投稿（チャンネル）</h2>
        <p className="text-xs text-ink-mute">30秒ごとに自動で更新されます。会員同士・会員と運営のダイレクトメッセージは表示されません。</p>
        <div className="card p-0 divide-y divide-surface-line">
          {recent.length === 0 && <p className="px-4 py-6 text-sm text-ink-mute text-center">まだ投稿はありません。</p>}
          {recent.map((m) => (
            <Link
              key={m.id}
              href={`/community?c=${m.channel_id}&m=${m.id}`}
              target="_blank"
              rel="noopener"
              className="block px-4 py-2.5 hover:bg-surface-soft"
            >
              <p className="text-xs text-ink-mute">
                #{m.community_channels?.name ?? ""}
                {m.parent_id && "（スレッド返信）"}・{authorLabel(m.user_id)}・{formatDate(m.created_at, true)}
              </p>
              <p className="text-sm text-ink line-clamp-2">
                {plainText(m.body ?? "", (id) => displayNames.get(id) || realNames.get(id) || "会員", 200) ||
                  ((m.attachments ?? []).length > 0 ? "📎 添付ファイル" : "")}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
