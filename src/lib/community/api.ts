/**
 * コミュニティのデータアクセス（ブラウザの Supabase クライアントから、ログイン中の
 * ユーザーとして呼び出す）。権限の判定はすべて DB 側（RLS と community_* 関数）で行う。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATTACHMENT_ALLOWED_TYPES,
  ATTACHMENT_MAX_BYTES,
  type NotifyLevel,
} from "./constants";
import type {
  ActivityFeed,
  Attachment,
  Bootstrap,
  ChannelRow,
  CommunityProfile,
  HistoryPage,
  InitPayload,
  MemberList,
  Message,
  SearchHit,
  ThreadPage,
  UnreadSummary,
  UserInfo,
} from "./types";

type Db = SupabaseClient<any, any, any>;

export const PAGE_SIZE = 50;

/** Supabase のエラーを画面に出せるメッセージの Error にする。 */
function toError(error: { message?: string; code?: string } | null | undefined, fallback: string): Error {
  const message = error?.message?.trim();
  if (!message) return new Error(fallback);
  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) {
    return new Error("通信に失敗しました。接続を確認して、もう一度お試しください。");
  }
  if (/JWT|not authenticated|ログインが必要/i.test(message)) {
    return new Error("ログインの有効期限が切れました。ページを再読み込みしてください。");
  }
  return new Error(message);
}

async function rpc<T>(db: Db, fn: string, args?: Record<string, unknown>, fallback = "処理に失敗しました。"): Promise<T> {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) throw toError(error, fallback);
  return data as T;
}

/** DB・Realtime から来た行の欠損を補い、型どおりの形にそろえる。 */
export function normalizeMessage(raw: any): Message {
  return {
    id: String(raw.id),
    channel_id: String(raw.channel_id),
    user_id: raw.user_id ?? null,
    parent_id: raw.parent_id ?? null,
    body: typeof raw.body === "string" ? raw.body : "",
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    mentions: Array.isArray(raw.mentions) ? raw.mentions : [],
    mention_channel: !!raw.mention_channel,
    reactions: raw.reactions && typeof raw.reactions === "object" && !Array.isArray(raw.reactions) ? raw.reactions : {},
    reply_count: Number(raw.reply_count ?? 0) || 0,
    last_reply_at: raw.last_reply_at ?? null,
    last_reply_user_id: raw.last_reply_user_id ?? null,
    reply_user_ids: Array.isArray(raw.reply_user_ids) ? raw.reply_user_ids : [],
    is_pinned: !!raw.is_pinned,
    pinned_by: raw.pinned_by ?? null,
    pinned_at: raw.pinned_at ?? null,
    edited_at: raw.edited_at ?? null,
    deleted_at: raw.deleted_at ?? null,
    deleted_by: raw.deleted_by ?? null,
    created_at: String(raw.created_at),
  };
}

export function normalizeChannel(raw: any): ChannelRow {
  return {
    ...raw,
    audience_plan_codes: raw.audience_plan_codes ?? [],
    audience_horse_ids: raw.audience_horse_ids ?? [],
    unread_count: Number(raw.unread_count ?? 0) || 0,
    mention_count: Number(raw.mention_count ?? 0) || 0,
    created_by: raw.created_by ?? null,
    can_manage: !!raw.can_manage,
    last_message_preview: raw.last_message_preview ?? null,
    last_message_user_id: raw.last_message_user_id ?? null,
    member_count: Number(raw.member_count ?? 0) || 0,
  } as ChannelRow;
}

function normalizeUsers(raw: any): UserInfo[] {
  return Array.isArray(raw) ? (raw as UserInfo[]).filter((u) => u && typeof u.user_id === "string") : [];
}

function normalizeHistory(raw: any): HistoryPage {
  return {
    messages: Array.isArray(raw?.messages) ? raw.messages.map(normalizeMessage) : [],
    has_more: !!raw?.has_more,
    users: normalizeUsers(raw?.users),
  };
}

/** community_init() の結果を型どおりにそろえる（サーバー・ブラウザ共用）。 */
export function normalizeInit(raw: any): InitPayload {
  const base = (raw ?? { authenticated: false }) as InitPayload;
  if (!base.is_member) return base;
  return {
    ...base,
    channels: Array.isArray(raw.channels) ? raw.channels.map(normalizeChannel) : [],
    channel_id: raw.channel_id ?? null,
    history: raw.history ? normalizeHistory(raw.history) : null,
    users: normalizeUsers(raw.users),
  };
}

// ---------------------------------------------------------------------------
// 状態・チャンネル
// ---------------------------------------------------------------------------

export function bootstrap(db: Db): Promise<Bootstrap> {
  return rpc<Bootstrap>(db, "community_bootstrap", undefined, "コミュニティを読み込めませんでした。");
}

export async function listChannels(db: Db): Promise<ChannelRow[]> {
  const rows = await rpc<any[]>(db, "community_list_channels", undefined, "チャンネル一覧を読み込めませんでした。");
  return attachIcons(db, (rows ?? []).map(normalizeChannel));
}

/**
 * チャンネルのアイコン（community_channels.icon）を一覧に付ける。
 * 列がまだ無い（データベース更新前）・取得に失敗した場合はアイコン無しのまま返す。
 */
export async function attachIcons(db: Db, rows: ChannelRow[]): Promise<ChannelRow[]> {
  const ids = rows.filter((r) => r.kind === "channel").map((r) => r.id);
  if (ids.length === 0) return rows;
  try {
    const { data, error } = await db.from("community_channels").select("id, icon").in("id", ids);
    if (error || !data) return rows;
    const icons = new Map<string, string | null>((data as { id: string; icon: string | null }[]).map((r) => [r.id, r.icon]));
    return rows.map((r) => (icons.has(r.id) ? { ...r, icon: icons.get(r.id) ?? null } : r));
  } catch {
    return rows;
  }
}

/** チャンネルのアイコンを設定する（画像ファイル または 絵文字）。新しいアイコンを返す。 */
export async function setChannelIcon(channelId: string, input: { file: File } | { emoji: string }): Promise<string | null> {
  let res: Response;
  try {
    if ("file" in input) {
      const fd = new FormData();
      fd.append("file", input.file);
      res = await fetch(`/api/community/channels/${channelId}/icon`, { method: "POST", body: fd, credentials: "same-origin" });
    } else {
      res = await fetch(`/api/community/channels/${channelId}/icon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: input.emoji }),
        credentials: "same-origin",
      });
    }
  } catch {
    throw new Error("通信に失敗しました。接続を確認して、もう一度お試しください。");
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error ?? "アイコンを変更できませんでした。");
  return (j?.icon as string | null) ?? null;
}

/** チャンネルのアイコンを外す（# / 鍵のマークに戻す）。 */
export async function clearChannelIcon(channelId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/community/channels/${channelId}/icon`, { method: "DELETE", credentials: "same-origin" });
  } catch {
    throw new Error("通信に失敗しました。接続を確認して、もう一度お試しください。");
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? "アイコンを外せませんでした。");
  }
}

export async function unreadSummary(db: Db): Promise<UnreadSummary | null> {
  const { data, error } = await db.rpc("community_unread_summary");
  if (error || !data) return null;
  return {
    badge: Number((data as any).badge ?? 0) || 0,
    has_unread: !!(data as any).has_unread,
    dm_unread: Number((data as any).dm_unread ?? 0) || 0,
    unread_total: Number((data as any).unread_total ?? (data as any).badge ?? 0) || 0,
  };
}

export function joinChannel(db: Db, channelId: string): Promise<void> {
  return rpc<void>(db, "community_join", { p_channel: channelId }, "チャンネルに参加できませんでした。");
}

export function leaveChannel(db: Db, channelId: string): Promise<void> {
  return rpc<void>(db, "community_leave", { p_channel: channelId }, "チャンネルから退出できませんでした。");
}

export function markRead(db: Db, channelId: string): Promise<string> {
  return rpc<string>(db, "community_mark_read", { p_channel: channelId });
}

/** 指定したメッセージ以降を未読に戻す。戻り値は新しい既読位置。 */
export function markUnread(db: Db, messageId: string): Promise<string> {
  return rpc<string>(db, "community_mark_unread", { p_message: messageId }, "未読にできませんでした。");
}

export function setPrefs(
  db: Db,
  channelId: string,
  prefs: { notify?: NotifyLevel | "default"; starred?: boolean },
): Promise<void> {
  return rpc<void>(
    db,
    "community_set_prefs",
    { p_channel: channelId, p_notify: prefs.notify ?? null, p_starred: prefs.starred ?? null },
    "設定を保存できませんでした。",
  );
}

export function openDm(db: Db, userId: string): Promise<string> {
  return rpc<string>(db, "community_open_dm", { p_user: userId }, "ダイレクトメッセージを開けませんでした。");
}

// ---------------------------------------------------------------------------
// メッセージ
// ---------------------------------------------------------------------------

/** 画面の初期データ（利用状態・チャンネル一覧・最初のチャンネルのメッセージ）を1回で取得する。 */
export async function init(db: Db, channelId?: string | null): Promise<InitPayload> {
  const data = await rpc<any>(db, "community_init", { p_channel: channelId ?? null }, "コミュニティを読み込めませんでした。");
  const payload = normalizeInit(data);
  if (payload.is_member && payload.channels) payload.channels = await attachIcons(db, payload.channels);
  return payload;
}

/**
 * チャンネル直下のメッセージ（古い順）と表示に必要なユーザー情報。
 * before（最も古い読み込み済みメッセージ）を渡すとそれより前の PAGE_SIZE 件。
 */
export async function loadHistory(
  db: Db,
  channelId: string,
  before?: Pick<Message, "created_at" | "id"> | null,
): Promise<HistoryPage> {
  const data = await rpc<any>(
    db,
    "community_history",
    {
      p_channel: channelId,
      p_before: before?.created_at ?? null,
      p_before_id: before?.id ?? null,
      p_limit: PAGE_SIZE,
    },
    "メッセージを読み込めませんでした。",
  );
  return normalizeHistory(data);
}

export async function loadThread(db: Db, parentId: string): Promise<ThreadPage> {
  const data = await rpc<any>(db, "community_thread", { p_parent: parentId }, "スレッドを読み込めませんでした。");
  return {
    parent: normalizeMessage(data.parent),
    replies: Array.isArray(data?.replies) ? data.replies.map(normalizeMessage) : [],
    users: normalizeUsers(data?.users),
  };
}

export async function loadMessage(db: Db, id: string): Promise<Message | null> {
  const { data, error } = await db.from("community_messages").select("*").eq("id", id).maybeSingle();
  if (error) throw toError(error, "メッセージを読み込めませんでした。");
  return data ? normalizeMessage(data) : null;
}

export async function loadPinned(db: Db, channelId: string): Promise<Message[]> {
  const { data, error } = await db
    .from("community_messages")
    .select("*")
    .eq("channel_id", channelId)
    .eq("is_pinned", true)
    .order("pinned_at", { ascending: false })
    .limit(100);
  if (error) throw toError(error, "ピン留めを読み込めませんでした。");
  return (data ?? []).map(normalizeMessage);
}

/** 既読位置（user_id → last_read_at）。 */
export async function loadReceipts(db: Db, channelId: string): Promise<Record<string, string>> {
  const { data, error } = await db
    .from("community_channel_members")
    .select("user_id, last_read_at")
    .eq("channel_id", channelId)
    .not("last_read_at", "is", null)
    .limit(5000);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const r of data ?? []) out[(r as any).user_id] = (r as any).last_read_at;
  return out;
}

export async function sendMessage(
  db: Db,
  args: {
    channelId: string;
    body: string;
    parentId?: string | null;
    attachments?: Attachment[];
    mentions?: string[];
    mentionChannel?: boolean;
  },
): Promise<Message> {
  const data = await rpc<any>(
    db,
    "community_send",
    {
      p_channel: args.channelId,
      p_body: args.body,
      p_parent: args.parentId ?? null,
      p_attachments: args.attachments ?? [],
      p_mentions: args.mentions ?? [],
      p_mention_channel: !!args.mentionChannel,
    },
    "メッセージを送信できませんでした。",
  );
  return normalizeMessage(data);
}

export async function editMessage(db: Db, messageId: string, body: string, mentions: string[]): Promise<Message> {
  const data = await rpc<any>(
    db,
    "community_edit",
    { p_message: messageId, p_body: body, p_mentions: mentions },
    "メッセージを編集できませんでした。",
  );
  return normalizeMessage(data);
}

/** 削除し、添付ファイル（自分のもの）も VPS から削除する。 */
export async function deleteMessage(db: Db, messageId: string): Promise<void> {
  const attachments = await rpc<Attachment[] | null>(
    db,
    "community_delete",
    { p_message: messageId },
    "メッセージを削除できませんでした。",
  );
  const paths = (attachments ?? []).map((a) => a?.path).filter((p): p is string => typeof p === "string" && !!p);
  if (paths.length > 0) {
    // 失敗してもメッセージの削除自体は完了している（ファイルは参照されなくなる）。
    await removeAttachments(paths);
  }
}

export async function toggleReaction(db: Db, messageId: string, emoji: string): Promise<Message> {
  const data = await rpc<any>(
    db,
    "community_toggle_reaction",
    { p_message: messageId, p_emoji: emoji },
    "リアクションできませんでした。",
  );
  return normalizeMessage(data);
}

export async function togglePin(db: Db, messageId: string): Promise<Message> {
  const data = await rpc<any>(db, "community_toggle_pin", { p_message: messageId }, "ピン留めできませんでした。");
  return normalizeMessage(data);
}

export function reportMessage(db: Db, messageId: string, reason: string): Promise<string> {
  return rpc<string>(db, "community_report", { p_message: messageId, p_reason: reason }, "通報できませんでした。");
}

export async function searchMessages(db: Db, query: string, channelId?: string | null): Promise<SearchHit[]> {
  const rows = await rpc<SearchHit[]>(
    db,
    "community_search",
    { p_query: query, p_channel: channelId ?? null },
    "検索できませんでした。",
  );
  return rows ?? [];
}

// ---------------------------------------------------------------------------
// チャンネルの作成・管理
// ---------------------------------------------------------------------------

export function createChannel(
  db: Db,
  args: {
    name: string;
    description?: string;
    visibility: "public" | "private";
    members?: string[];
    postPolicy?: "everyone" | "staff";
    autoJoin?: boolean;
  },
): Promise<string> {
  return rpc<string>(
    db,
    "community_create_channel",
    {
      p_name: args.name,
      p_description: args.description ?? null,
      p_visibility: args.visibility,
      p_members: args.members ?? [],
      p_post_policy: args.postPolicy ?? "everyone",
      p_auto_join: !!args.autoJoin,
    },
    "チャンネルを作成できませんでした。",
  );
}

/** null の項目は変更しない。空文字は消去。 */
export function updateChannel(
  db: Db,
  channelId: string,
  patch: { name?: string | null; topic?: string | null; description?: string | null },
): Promise<void> {
  return rpc<void>(
    db,
    "community_update_channel",
    {
      p_channel: channelId,
      p_name: patch.name ?? null,
      p_topic: patch.topic ?? null,
      p_description: patch.description ?? null,
    },
    "チャンネルを更新できませんでした。",
  );
}

export function setChannelArchived(db: Db, channelId: string, archived: boolean): Promise<void> {
  return rpc<void>(
    db,
    "community_set_channel_archived",
    { p_channel: channelId, p_archived: archived },
    "チャンネルを更新できませんでした。",
  );
}

export async function inviteMembers(db: Db, channelId: string, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const n = await rpc<number>(
    db,
    "community_invite",
    { p_channel: channelId, p_users: userIds },
    "メンバーを追加できませんでした。",
  );
  return Number(n) || 0;
}

export function removeMember(db: Db, channelId: string, userId: string): Promise<void> {
  return rpc<void>(
    db,
    "community_remove_member",
    { p_channel: channelId, p_user: userId },
    "メンバーを外せませんでした。",
  );
}

export async function memberList(db: Db, channelId: string): Promise<MemberList> {
  const data = await rpc<any>(
    db,
    "community_channel_member_list",
    { p_channel: channelId },
    "メンバーを読み込めませんでした。",
  );
  return { total: Number(data?.total ?? 0) || 0, users: normalizeUsers(data?.users) };
}

export async function inviteCandidates(db: Db, channelId: string | null, query: string): Promise<UserInfo[]> {
  const rows = await rpc<any[]>(
    db,
    "community_invite_candidates",
    { p_channel: channelId, p_query: query },
    "メンバーを検索できませんでした。",
  );
  return normalizeUsers(rows);
}

export async function activity(db: Db): Promise<ActivityFeed> {
  const data = await rpc<any>(db, "community_activity", { p_limit: 50 }, "アクティビティを読み込めませんでした。");
  return {
    items: Array.isArray(data?.items)
      ? data.items.map((i: any) => ({ reason: i.reason, message: normalizeMessage(i.message) }))
      : [],
    seen_at: data?.seen_at ?? null,
    users: normalizeUsers(data?.users),
  };
}

export function markActivitySeen(db: Db): Promise<string> {
  return rpc<string>(db, "community_mark_activity_seen");
}

// ---------------------------------------------------------------------------
// ユーザー
// ---------------------------------------------------------------------------

export async function userInfo(db: Db, ids: string[]): Promise<UserInfo[]> {
  if (ids.length === 0) return [];
  return (await rpc<UserInfo[]>(db, "community_user_info", { p_users: ids })) ?? [];
}

export async function directory(db: Db, query: string): Promise<UserInfo[]> {
  const rows = (await rpc<UserInfo[]>(db, "community_directory", { p_query: query }, "メンバーを検索できませんでした。")) ?? [];
  // 運営・テスト管理者は DM 相手候補に出さない（会員同士の連絡用）。
  return rows.filter((u) => !u.is_staff);
}

export async function mentionCandidates(db: Db, channelId: string, query: string): Promise<UserInfo[]> {
  const rows = await rpc<any[]>(db, "community_mention_candidates", { p_channel: channelId, p_query: query });
  return (rows ?? []).map((r) => ({ ...r, real_name: null }));
}

export function updateProfile(
  db: Db,
  args: { displayName: string; bio: string; allowDm: boolean },
): Promise<CommunityProfile> {
  return rpc<CommunityProfile>(
    db,
    "community_update_profile",
    { p_display_name: args.displayName, p_bio: args.bio, p_allow_dm: args.allowDm },
    "プロフィールを保存できませんでした。",
  );
}

// ---------------------------------------------------------------------------
// 添付ファイル
// ---------------------------------------------------------------------------

/** アップロード前の検証。問題があればメッセージを返す。 */
export function validateAttachment(file: File): string | null {
  if (file.size > ATTACHMENT_MAX_BYTES) return `「${file.name}」は10MBを超えているため添付できません。`;
  if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
    return `「${file.name}」は添付できない形式です（画像・PDF・Office文書・テキストのみ）。`;
  }
  return null;
}

/**
 * 添付ファイルは VPS に保存する（/api/community/files 経由。DB にはパスだけを保存）。
 * 権限の判定はサーバー側で従来と同じ community_storage_can_* 関数を使って行う。
 */
export async function uploadAttachment(_db: Db, channelId: string, _userId: string, file: File): Promise<Attachment> {
  const problem = validateAttachment(file);
  if (problem) throw new Error(problem);
  const fd = new FormData();
  fd.append("file", file);
  fd.append("channelId", channelId);
  let res: Response;
  try {
    res = await fetch("/api/community/files", { method: "POST", body: fd, credentials: "same-origin" });
  } catch {
    throw new Error("通信に失敗しました。接続を確認して、もう一度お試しください。");
  }
  const j = await res.json().catch(() => null);
  if (!res.ok || typeof j?.path !== "string") {
    throw new Error(j?.error ?? `「${file.name}」をアップロードできませんでした。`);
  }
  return { path: j.path, name: j.name, type: j.type, size: j.size };
}

/** 添付ファイルを削除する（自分のファイル、または運営）。失敗しても例外は投げない。 */
export async function removeAttachments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await fetch("/api/community/files", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
    credentials: "same-origin",
  }).catch(() => undefined);
}

/** 閲覧用の URL（ログイン中のユーザーの権限をサーバーが都度確認して配信する）。 */
export async function signedUrls(_db: Db, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of paths) {
    if (p) out[p] = `/api/community/files/${p.split("/").map(encodeURIComponent).join("/")}`;
  }
  return out;
}
