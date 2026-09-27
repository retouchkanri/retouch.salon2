"use client";

/**
 * コミュニティ画面の状態とアクション。
 *   - 状態は外部ストア（useSyncExternalStore）に置き、各コンポーネントは必要な部分だけを
 *     購読する（入力中表示やオンライン表示の更新で、メッセージ一覧全体を描き直さない）。
 *   - 初期データはサーバーで community_init を1回呼んで渡す（最初の表示で読み込み待ちが無い）。
 *   - Supabase Realtime（新着・編集・リアクション・既読・招待・入力中・オンライン）
 *   - 通知（画面内トースト / デスクトップ通知 / タイトルの未読数）
 * 権限の判定はすべて DB 側（RLS・community_* 関数）で行い、ここでは表示だけを制御する。
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import * as api from "@/lib/community/api";
import { COMMUNITY_BUCKET, MESSAGE_MAX_LENGTH, type NotifyLevel } from "@/lib/community/constants";
import {
  badgeCount,
  encodeMentions,
  isMentioned,
  mergeMessages,
  plainText,
  shouldNotify,
  upsertMessage,
  type KnownMention,
} from "@/lib/community/text";
import type {
  ActivityItem,
  ChannelRow,
  CommunityProfile,
  InitPayload,
  Message,
  UserInfo,
} from "@/lib/community/types";

type Db = ReturnType<typeof getSupabaseBrowserClient>;

export type ChannelMessages = {
  items: Message[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
};

export type ThreadState = { items: Message[]; loading: boolean; loaded: boolean };

export type Toast = {
  id: string;
  kind: "message" | "info" | "error";
  title: string;
  body?: string;
  channelId?: string;
  parentId?: string;
};

export type Me = { id: string; isStaff: boolean; profile: CommunityProfile | null };

/** 左端のナビゲーション（Slack の「ホーム」「DM」「アクティビティ」）。 */
export type View = "home" | "dms" | "activity";

export type MembersState = { total: number; ids: string[]; loading: boolean; loadedAt: number };

export type ActivityState = {
  items: ActivityItem[];
  seenAt: string | null;
  loaded: boolean;
  loading: boolean;
  /** 未確認の件数（リアルタイムの新着も含む） */
  unread: number;
};

export type State = {
  me: Me;
  fatal: string | null;
  channels: ChannelRow[];
  currentId: string | null;
  view: View;
  mobileView: "list" | "channel";
  messages: Record<string, ChannelMessages>;
  dividerAt: Record<string, string | null>;
  threadParentId: string | null;
  threadParents: Record<string, Message>;
  threads: Record<string, ThreadState>;
  highlightId: string | null;
  users: Record<string, UserInfo>;
  receipts: Record<string, string>;
  typing: Record<string, Record<string, number>>;
  online: Set<string>;
  signed: Record<string, string>;
  toasts: Toast[];
  notificationPermission: NotificationPermission | "unsupported";
  members: Record<string, MembersState>;
  activity: ActivityState;
};

// ---------------------------------------------------------------------------
// 小さな外部ストア
// ---------------------------------------------------------------------------

type Listener = () => void;

class Store {
  private state: State;
  private listeners = new Set<Listener>();
  constructor(initial: State) {
    this.state = initial;
  }
  get = (): State => this.state;
  set = (update: Partial<State> | ((s: State) => Partial<State> | State | null)) => {
    const patch = typeof update === "function" ? update(this.state) : update;
    if (!patch || patch === this.state) return;
    let changed = false;
    for (const k of Object.keys(patch) as (keyof State)[]) {
      if (this.state[k] !== patch[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
}

const StoreCtx = createContext<Store | null>(null);
const ActionsCtx = createContext<Actions | null>(null);

const UNSET = Symbol("unset");

/** 状態の一部を購読する。selector の結果が eq で等しい間は再描画しない。 */
export function useCS<T>(selector: (s: State) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const store = useContext(StoreCtx);
  if (!store) throw new Error("useCS must be used inside <CommunityProvider>");
  const selRef = useRef(selector);
  selRef.current = selector;
  const eqRef = useRef(eq);
  eqRef.current = eq;
  const last = useRef<T | typeof UNSET>(UNSET);
  const getSnapshot = () => {
    const next = selRef.current(store.get());
    const prev = last.current;
    if (prev !== UNSET && eqRef.current(prev, next)) return prev;
    last.current = next;
    return next;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function shallowArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

export function useActions(): Actions {
  const a = useContext(ActionsCtx);
  if (!a) throw new Error("useActions must be used inside <CommunityProvider>");
  return a;
}

export function displayName(s: Pick<State, "users" | "me">, id: string | null | undefined): string {
  if (!id) return "退会したユーザー";
  if (id === s.me.id && s.me.profile?.display_name) return s.me.profile.display_name;
  const u = s.users[id];
  if (u?.display_name) return u.display_name;
  if (u?.real_name) return u.real_name;
  return u?.is_staff ? "運営スタッフ" : "会員";
}

export const useMe = () => useCS((s) => s.me);
export const useChannel = (id: string | null | undefined) =>
  useCS((s) => (id ? s.channels.find((c) => c.id === id) : undefined));
export const useUser = (id: string | null | undefined) => useCS((s) => (id ? s.users[id] : undefined));
export const useName = (id: string | null | undefined) => useCS((s) => displayName(s, id));
export const useOnline = (id: string | null | undefined) => useCS((s) => (id ? s.online.has(id) : false));

/** 表示名を返す関数（ユーザー情報が変わると新しい関数になる）。一覧・モーダル向け。 */
export function useNameOf(): (id: string | null | undefined) => string {
  const users = useCS((s) => s.users);
  const me = useMe();
  return useMemo(() => (id: string | null | undefined) => displayName({ users, me }, id), [users, me]);
}

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

const EMPTY_CHANNEL: ChannelMessages = { items: [], loaded: false, loading: false, hasMore: true, error: null };
const LAST_CHANNEL_COOKIE = "community_last";
const TYPING_TTL_MS = 6000;
const SIGNED_TTL_MS = 55 * 60 * 1000;
const MEMBERS_TTL_MS = 60 * 1000;

function isPageVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

export function isDesktopWidth(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

/** 前回開いたチャンネル（次回はサーバーがこのチャンネルの内容を最初から含めて返す）。 */
function rememberChannel(id: string) {
  try {
    document.cookie = `${LAST_CHANNEL_COOKIE}=${id}; path=/community; max-age=31536000; samesite=lax`;
  } catch {
    // 記憶できなくても次回は既定のチャンネルが開くだけ
  }
}

function setUrlChannel(id: string | null) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    url.searchParams.delete("dm");
    url.searchParams.delete("m");
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // URL の更新に失敗しても画面の動作には影響しない
  }
}

function usersMap(list: UserInfo[] | undefined, base: Record<string, UserInfo> = {}): Record<string, UserInfo> {
  if (!list || list.length === 0) return base;
  const next = { ...base };
  for (const u of list) next[u.user_id] = { ...next[u.user_id], ...u };
  return next;
}

function sortedJoinedChannels(channels: ChannelRow[]): ChannelRow[] {
  return channels
    .filter((r) => r.joined && r.kind === "channel")
    .sort((a, b) => a.sort_order - b.sort_order || (a.name ?? "").localeCompare(b.name ?? "", "ja"));
}

export function initialState(init: InitPayload, explicitChannel: boolean): State {
  const channels = init.channels ?? [];
  const current = init.channel_id ?? null;
  const ch = channels.find((c) => c.id === current);
  const history = init.history;
  const users = usersMap([...(init.users ?? []), ...(history?.users ?? [])]);
  return {
    me: { id: init.user_id as string, isStaff: !!init.is_staff, profile: init.profile ?? null },
    fatal: null,
    channels,
    currentId: current,
    view: "home",
    mobileView: explicitChannel && current ? "channel" : "list",
    messages:
      current && history
        ? { [current]: { items: history.messages, loaded: true, loading: false, hasMore: history.has_more, error: null } }
        : {},
    dividerAt: current && ch ? { [current]: ch.unread_count > 0 ? ch.last_read_at ?? ch.created_at : null } : {},
    threadParentId: null,
    threadParents: {},
    threads: {},
    highlightId: null,
    users,
    receipts: {},
    typing: {},
    online: new Set(),
    signed: {},
    toasts: [],
    notificationPermission: "unsupported",
    members: {},
    activity: { items: [], seenAt: init.profile?.activity_seen_at ?? null, loaded: false, loading: false, unread: 0 },
  };
}

// ---------------------------------------------------------------------------
// アクション
// ---------------------------------------------------------------------------

export type SendArgs = {
  channelId: string;
  text: string;
  known: KnownMention[];
  files: File[];
  parentId?: string | null;
};

export type Actions = ReturnType<typeof createActions>;

function createActions(store: Store, db: Db) {
  const get = store.get;
  const set = store.set;

  const drafts: Record<string, { text: string; known: KnownMention[] }> = {};
  const pendingUsers = new Set<string>();
  const inflightUsers = new Set<string>();
  let userTimer: ReturnType<typeof setTimeout> | null = null;
  const signedAt: Record<string, number> = {};
  const pendingSigned = new Set<string>();
  const markTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let typingChannel: RealtimeChannel | null = null;
  let lastTypingSent = 0;
  const seenReplies = new Set<string>();
  const notifiedIds = new Set<string>();
  const prefetching = new Set<string>();

  const nameOf = (id: string | null | undefined) => displayName(get(), id);
  const channelOf = (id: string | null | undefined) => (id ? get().channels.find((c) => c.id === id) : undefined);

  // ---------------------------------------------------------------- toasts
  const dismissToast = (id: string) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  const pushToast = (t: Omit<Toast, "id"> & { id?: string }) => {
    const id = t.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== id), { ...t, id }].slice(-4) }));
    setTimeout(() => dismissToast(id), t.kind === "error" ? 8000 : 5000);
  };
  const fail = (e: unknown, fallback: string) =>
    pushToast({ kind: "error", title: e instanceof Error && e.message ? e.message : fallback });

  // ---------------------------------------------------------------- users
  const mergeUsers = (list: UserInfo[]) => {
    if (list.length === 0) return;
    set((s) => ({ users: usersMap(list, s.users) }));
  };

  const flushUsers = async () => {
    userTimer = null;
    const ids = Array.from(pendingUsers);
    pendingUsers.clear();
    if (ids.length === 0) return;
    ids.forEach((id) => inflightUsers.add(id));
    try {
      const rows = await api.userInfo(db, ids);
      set((s) => {
        const next = { ...s.users };
        for (const id of ids) {
          next[id] = rows.find((r) => r.user_id === id) ?? {
            user_id: id,
            display_name: null,
            avatar_url: null,
            is_staff: false,
            real_name: null,
          };
        }
        return { users: next };
      });
    } catch {
      // 表示名が取れなくても「会員」と表示されるだけ。次回の要求で再取得する。
    } finally {
      ids.forEach((id) => inflightUsers.delete(id));
    }
  };

  const ensureUsers = (ids: (string | null | undefined)[]) => {
    const users = get().users;
    let added = false;
    for (const id of ids) {
      if (!id || users[id] || pendingUsers.has(id) || inflightUsers.has(id)) continue;
      pendingUsers.add(id);
      added = true;
    }
    if (added && !userTimer) userTimer = setTimeout(flushUsers, 40);
  };

  // ---------------------------------------------------------------- attachments
  const ensureSigned = (paths: string[]) => {
    const now = Date.now();
    const need = paths.filter((p) => p && !pendingSigned.has(p) && (signedAt[p] ?? 0) + SIGNED_TTL_MS < now);
    if (need.length === 0) return;
    need.forEach((p) => pendingSigned.add(p));
    api
      .signedUrls(db, need)
      .then((urls) => {
        const at = Date.now();
        for (const p of Object.keys(urls)) signedAt[p] = at;
        if (Object.keys(urls).length > 0) set((s) => ({ signed: { ...s.signed, ...urls } }));
      })
      .finally(() => need.forEach((p) => pendingSigned.delete(p)));
  };

  const prepareMessages = (list: Message[]) => {
    const ids: string[] = [];
    const paths: string[] = [];
    for (const m of list) {
      ids.push(m.user_id ?? "", ...m.mentions, ...m.reply_user_ids.slice(0, 3));
      for (const a of m.attachments) paths.push(a.path);
    }
    ensureUsers(ids);
    ensureSigned(paths);
  };

  // ---------------------------------------------------------------- channels
  const refreshChannels = async () => {
    try {
      const rows = await api.listChannels(db);
      set({ channels: rows });
      ensureUsers(rows.flatMap((r) => [r.dm_user_id, r.last_message_user_id]));
    } catch (e) {
      if (!get().channels.length) set({ fatal: e instanceof Error ? e.message : "読み込みに失敗しました。" });
    }
  };

  const scheduleRefreshChannels = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshChannels();
    }, 600);
  };

  const patchChannel = (id: string, patch: Partial<ChannelRow>) =>
    set((s) => ({ channels: s.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const doMarkRead = async (id: string) => {
    const ch = channelOf(id);
    if (!ch) return;
    if (ch.unread_count > 0 || ch.mention_count > 0) patchChannel(id, { unread_count: 0, mention_count: 0 });
    try {
      const at = await api.markRead(db, id);
      patchChannel(id, { last_read_at: at });
    } catch {
      // 既読の記録に失敗しても表示上は既読扱いのまま（次回の一覧更新で正しい値に戻る）
    }
  };

  const scheduleMarkRead = (id: string) => {
    if (markTimers[id]) clearTimeout(markTimers[id]);
    markTimers[id] = setTimeout(() => {
      delete markTimers[id];
      if (get().currentId === id && isPageVisible()) void doMarkRead(id);
    }, 400);
  };

  // ---------------------------------------------------------------- messages
  const setChannelMessages = (id: string, fn: (st: ChannelMessages) => ChannelMessages) =>
    set((s) => ({ messages: { ...s.messages, [id]: fn(s.messages[id] ?? EMPTY_CHANNEL) } }));

  const loadChannel = async (id: string) => {
    const st = get().messages[id];
    if (st?.loading || st?.loaded) return;
    setChannelMessages(id, (p) => ({ ...p, loading: true, error: null }));
    try {
      const page = await api.loadHistory(db, id);
      mergeUsers(page.users);
      prepareMessages(page.messages);
      setChannelMessages(id, (p) => ({
        items: mergeMessages(p.items, page.messages),
        loaded: true,
        loading: false,
        hasMore: page.has_more,
        error: null,
      }));
    } catch (e) {
      setChannelMessages(id, (p) => ({
        ...p,
        loading: false,
        error: e instanceof Error ? e.message : "読み込めませんでした。",
      }));
    }
  };

  /** サイドバーでカーソルを合わせたときなどに先読みする（開いたときに待たずに表示できる）。 */
  const prefetch = (id: string) => {
    if (prefetching.has(id) || get().messages[id]) return;
    prefetching.add(id);
    void loadChannel(id).finally(() => prefetching.delete(id));
  };

  const loadOlder = async (id: string): Promise<boolean> => {
    const st = get().messages[id];
    if (!st || st.loading || !st.hasMore) return false;
    const oldest = st.items[0];
    setChannelMessages(id, (p) => ({ ...p, loading: true }));
    try {
      const page = await api.loadHistory(db, id, oldest ?? null);
      mergeUsers(page.users);
      prepareMessages(page.messages);
      setChannelMessages(id, (p) => ({
        ...p,
        items: mergeMessages(p.items, page.messages),
        loading: false,
        hasMore: page.has_more,
      }));
      return page.messages.length > 0;
    } catch (e) {
      setChannelMessages(id, (p) => ({ ...p, loading: false }));
      fail(e, "読み込めませんでした。");
      return false;
    }
  };

  /**
   * メッセージ（トップレベル・スレッド・スレッドの親）を反映する。
   * mode "upsert" は新着（末尾に追加）、"replace" は編集・リアクション等で表示中のものだけ置き換える
   * （読み込んでいない古いメッセージを一覧の途中に紛れ込ませない）。
   */
  const applyMessage = (msg: Message, mode: "upsert" | "replace" = "replace") => {
    const merge = (items: Message[]) => {
      if (mode === "upsert") return upsertMessage(items, msg);
      return items.some((m) => m.id === msg.id) ? upsertMessage(items, msg) : items;
    };
    set((s) => {
      if (msg.parent_id) {
        const t = s.threads[msg.parent_id];
        if (!t) return null;
        const items = merge(t.items);
        return items === t.items ? null : { threads: { ...s.threads, [msg.parent_id]: { ...t, items } } };
      }
      const patch: Partial<State> = {};
      const st = s.messages[msg.channel_id];
      if (st?.loaded) {
        const items = merge(st.items);
        if (items !== st.items) patch.messages = { ...s.messages, [msg.channel_id]: { ...st, items } };
      }
      if (s.threadParents[msg.id]) patch.threadParents = { ...s.threadParents, [msg.id]: msg };
      if (s.activity.items.some((i) => i.message.id === msg.id)) {
        patch.activity = {
          ...s.activity,
          items: s.activity.items.map((i) => (i.message.id === msg.id ? { ...i, message: msg } : i)),
        };
      }
      return patch;
    });
  };

  const findLoaded = (id: string): Message | undefined => {
    const s = get();
    for (const st of Object.values(s.messages)) {
      const m = st.items.find((x) => x.id === id);
      if (m) return m;
    }
    return s.threadParents[id];
  };

  const openThread = (parentId: string | null) => {
    set({ threadParentId: parentId });
    if (!parentId) return;
    const inList = findLoaded(parentId);
    if (inList) set((s) => ({ threadParents: { ...s.threadParents, [parentId]: inList } }));
    set((s) => ({
      threads: {
        ...s.threads,
        [parentId]: {
          items: s.threads[parentId]?.items ?? [],
          loading: true,
          loaded: s.threads[parentId]?.loaded ?? false,
        },
      },
    }));
    api
      .loadThread(db, parentId)
      .then((t) => {
        mergeUsers(t.users);
        prepareMessages([t.parent, ...t.replies]);
        set((s) => ({
          threadParents: { ...s.threadParents, [parentId]: t.parent },
          threads: {
            ...s.threads,
            [parentId]: { items: mergeMessages(s.threads[parentId]?.items ?? [], t.replies), loading: false, loaded: true },
          },
        }));
      })
      .catch((e) => {
        set((s) => ({
          threads: {
            ...s.threads,
            [parentId]: { ...(s.threads[parentId] ?? { items: [] }), loading: false, loaded: true },
          },
        }));
        fail(e, "スレッドを読み込めませんでした。");
      });
  };

  const openChannel = (id: string | null) => {
    if (!id) {
      set({ currentId: null, mobileView: "list" });
      setUrlChannel(null);
      return;
    }
    const ch = channelOf(id);
    if (!ch) return;
    const s = get();
    const patch: Partial<State> = {
      currentId: id,
      mobileView: "channel",
      dividerAt: { ...s.dividerAt, [id]: ch.unread_count > 0 ? ch.last_read_at ?? ch.created_at : null },
    };
    if (s.view === "activity") patch.view = "home";
    const parent = s.threadParentId;
    if (parent) {
      const tp = findLoaded(parent);
      if (!tp || tp.channel_id !== id) patch.threadParentId = null;
    }
    set(patch);
    setUrlChannel(id);
    rememberChannel(id);
    void loadChannel(id);
    if (isPageVisible()) void doMarkRead(id);
  };

  const setView = (view: View) => {
    set({ view });
    if (view === "activity") {
      void loadActivity(true).then(() => markActivitySeen());
    }
  };

  const setMobileView = (v: "list" | "channel") => set({ mobileView: v });

  const jumpTo = async (target: { id: string; channel_id: string; parent_id: string | null }) => {
    if (!channelOf(target.channel_id)) await refreshChannels();
    openChannel(target.channel_id);
    if (target.parent_id) {
      openThread(target.parent_id);
      set({ highlightId: target.id });
    } else {
      // 読み込み済みの範囲に無ければ、見つかるまで過去に遡る（最大20ページ）
      await loadChannel(target.channel_id);
      for (let i = 0; i < 20; i++) {
        const st = get().messages[target.channel_id];
        if (st?.items.some((m) => m.id === target.id)) break;
        if (st?.loaded && !st.hasMore) break;
        if (!st?.loaded || st.loading) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        const more = await loadOlder(target.channel_id);
        if (!more) break;
      }
      set({ highlightId: target.id });
    }
    setTimeout(() => set((s) => (s.highlightId === target.id ? { highlightId: null } : null)), 4000);
  };

  // ---------------------------------------------------------------- notifications
  const requestNotificationPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const result = await Notification.requestPermission();
      set({ notificationPermission: result });
    } catch {
      set({ notificationPermission: Notification.permission });
    }
  };

  const showDesktop = (title: string, body: string, channelId: string, parentId?: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const options: NotificationOptions = { body, icon: "/icons/icon-192.png", tag: `community-${channelId}` };
    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        n.close();
        openChannel(channelId);
        if (parentId) openThread(parentId);
      };
    } catch {
      // Android など new Notification が使えない環境では Service Worker 経由で表示する
      navigator.serviceWorker
        ?.getRegistration?.()
        .then((reg) => reg?.showNotification(title, options))
        .catch(() => undefined);
    }
  };

  const notifyMessage = (ch: ChannelRow, msg: Message) => {
    if (notifiedIds.has(msg.id)) return;
    notifiedIds.add(msg.id);
    const author = nameOf(msg.user_id);
    const text = plainText(msg.body, nameOf) || (msg.attachments.length > 0 ? "📎 ファイルを送信しました" : "");
    const title = ch.kind === "dm" ? author : `#${ch.name ?? ""}`;
    const body = ch.kind === "dm" ? text : `${author}: ${text}`;
    pushToast({ id: `msg-${msg.id}`, kind: "message", title, body, channelId: ch.id });
    if (typeof document !== "undefined" && (document.hidden || !document.hasFocus())) showDesktop(title, body, ch.id);
  };

  const bumpActivity = (msg: Message, reason: ActivityItem["reason"]) => {
    set((s) => {
      if (s.activity.items.some((i) => i.message.id === msg.id)) return null;
      const viewing = s.view === "activity" && isPageVisible();
      return {
        activity: {
          ...s.activity,
          items: s.activity.loaded ? [{ reason, message: msg }, ...s.activity.items].slice(0, 100) : s.activity.items,
          unread: viewing ? s.activity.unread : s.activity.unread + 1,
        },
      };
    });
  };

  // ---------------------------------------------------------------- realtime handlers
  const onInsert = (raw: any) => {
    const msg = api.normalizeMessage(raw);
    const myId = get().me.id;
    prepareMessages([msg]);
    applyMessage(msg, "upsert");
    if (msg.parent_id) return;

    const ch = channelOf(msg.channel_id);
    if (!ch) {
      // 新しい DM・招待されたチャンネルなど、一覧にまだ無いチャンネル
      void refreshChannels().then(() => {
        const fresh = channelOf(msg.channel_id);
        if (fresh && shouldNotify({ ...fresh, joined: true }, msg, myId)) notifyMessage(fresh, msg);
      });
      return;
    }
    const viewing = get().currentId === ch.id && isPageVisible();
    const joined = ch.kind === "dm" ? true : ch.joined;
    const fromOther = msg.user_id !== myId;
    patchChannel(ch.id, {
      joined,
      last_message_at: msg.created_at,
      ...(ch.kind === "dm" ? { last_message_preview: msg.body.slice(0, 140), last_message_user_id: msg.user_id } : {}),
      unread_count: fromOther && joined && !viewing ? ch.unread_count + 1 : ch.unread_count,
      mention_count:
        fromOther && joined && !viewing && isMentioned(msg, myId) ? ch.mention_count + 1 : ch.mention_count,
    });
    if (fromOther && viewing) scheduleMarkRead(ch.id);
    if (fromOther && ch.kind === "channel" && !msg.deleted_at) {
      if (msg.mentions.includes(myId)) bumpActivity(msg, "mention");
      else if (msg.mention_channel && joined) bumpActivity(msg, "channel");
    }
    if (!viewing && shouldNotify({ ...ch, joined }, msg, myId)) notifyMessage(ch, msg);
  };

  const onUpdate = (raw: any) => {
    const msg = api.normalizeMessage(raw);
    const myId = get().me.id;
    prepareMessages([msg]);
    applyMessage(msg);
    // 自分のメッセージ・参加したスレッドへの返信を通知
    if (
      !msg.parent_id &&
      msg.last_reply_at &&
      msg.last_reply_user_id &&
      msg.last_reply_user_id !== myId &&
      (msg.user_id === myId || msg.reply_user_ids.includes(myId))
    ) {
      const key = `${msg.id}:${msg.last_reply_at}`;
      const fresh = Date.now() - new Date(msg.last_reply_at).getTime() < 60_000;
      const watching = get().threadParentId === msg.id && isPageVisible();
      if (fresh && !seenReplies.has(key)) {
        seenReplies.add(key);
        const ch = channelOf(msg.channel_id);
        if (ch?.kind === "channel") {
          set((s) => ({ activity: { ...s.activity, unread: s.activity.unread + (watching ? 0 : 1) } }));
          if (get().activity.loaded) void loadActivity(true);
        }
        if (!watching && ch && ch.notify !== "none") {
          const title = `スレッドへの返信（${ch.kind === "dm" ? nameOf(ch.dm_user_id) : `#${ch.name ?? ""}`}）`;
          const body = `${nameOf(msg.last_reply_user_id)} さんが返信しました`;
          pushToast({ id: `reply-${key}`, kind: "message", title, body, channelId: ch.id, parentId: msg.id });
          if (document.hidden || !document.hasFocus()) showDesktop(title, body, ch.id, msg.id);
        }
      }
    }
  };

  const resync = async () => {
    await refreshChannels();
    const id = get().currentId;
    if (id && get().messages[id]?.loaded) {
      try {
        const page = await api.loadHistory(db, id);
        mergeUsers(page.users);
        prepareMessages(page.messages);
        setChannelMessages(id, (p) => ({ ...p, items: mergeMessages(p.items, page.messages) }));
      } catch {
        // 次回の再接続で再取得する
      }
    }
  };

  // ---------------------------------------------------------------- typing
  const setTypingChannel = (ch: RealtimeChannel | null) => {
    typingChannel = ch;
  };
  const notifyTyping = (channelId: string) => {
    if (!typingChannel || channelId !== get().currentId) return;
    const now = Date.now();
    if (now - lastTypingSent < 3000) return;
    lastTypingSent = now;
    void typingChannel.send({ type: "broadcast", event: "typing", payload: { user_id: get().me.id } });
  };
  const onTyping = (channelId: string, uid: string) => {
    if (!uid || uid === get().me.id) return;
    ensureUsers([uid]);
    set((s) => ({
      typing: { ...s.typing, [channelId]: { ...(s.typing[channelId] ?? {}), [uid]: Date.now() + TYPING_TTL_MS } },
    }));
  };
  const expireTyping = () => {
    const now = Date.now();
    set((s) => {
      let changed = false;
      const next: State["typing"] = {};
      for (const [cid, m] of Object.entries(s.typing)) {
        const kept = Object.fromEntries(Object.entries(m).filter(([, exp]) => exp > now));
        if (Object.keys(kept).length !== Object.keys(m).length) changed = true;
        next[cid] = kept;
      }
      return changed ? { typing: next } : null;
    });
  };

  // ---------------------------------------------------------------- message actions
  const send = async ({ channelId, text, known, files, parentId }: SendArgs): Promise<boolean> => {
    const ch = channelOf(channelId);
    if (!ch) return false;
    const me = get().me;
    const { body, mentions, mentionChannel } = encodeMentions(text, known, me.isStaff && ch.kind === "channel");
    if (!body.trim() && files.length === 0) return false;
    if (body.length > MESSAGE_MAX_LENGTH) {
      pushToast({ kind: "error", title: `メッセージは${MESSAGE_MAX_LENGTH}文字以内で入力してください。` });
      return false;
    }
    const uploaded: string[] = [];
    const tempId = `optimistic:${crypto.randomUUID()}`;
    const stripTemp = () =>
      set((s) => {
        const strip = <T extends { items: Message[] }>(bag: Record<string, T>) => {
          let changed = false;
          const next = { ...bag };
          for (const key of Object.keys(next)) {
            if (next[key].items.some((m) => m.id === tempId)) {
              next[key] = { ...next[key], items: next[key].items.filter((m) => m.id !== tempId) };
              changed = true;
            }
          }
          return changed ? next : bag;
        };
        return { messages: strip(s.messages), threads: strip(s.threads) };
      });
    try {
      const attachments = [];
      for (const f of files) {
        const a = await api.uploadAttachment(db, channelId, me.id, f);
        uploaded.push(a.path);
        attachments.push(a);
      }

      // サーバ応答前に一覧へ出す（体感の送信待ちを無くす）
      const optimistic: Message = {
        id: tempId,
        channel_id: channelId,
        user_id: me.id,
        parent_id: parentId ?? null,
        body,
        attachments,
        mentions,
        mention_channel: mentionChannel,
        reactions: {},
        reply_count: 0,
        last_reply_at: null,
        last_reply_user_id: null,
        reply_user_ids: [],
        is_pinned: false,
        pinned_by: null,
        pinned_at: null,
        edited_at: null,
        deleted_at: null,
        deleted_by: null,
        created_at: new Date().toISOString(),
      };
      prepareMessages([optimistic]);
      applyMessage(optimistic, "upsert");

      const msg = await api.sendMessage(db, {
        channelId,
        body,
        parentId: parentId ?? null,
        attachments,
        mentions,
        mentionChannel,
      });
      stripTemp();
      prepareMessages([msg]);
      applyMessage(msg, "upsert");
      if (!msg.parent_id) {
        patchChannel(channelId, {
          joined: true,
          last_message_at: msg.created_at,
          last_read_at: msg.created_at,
          unread_count: 0,
          mention_count: 0,
          ...(ch.kind === "dm" ? { last_message_preview: msg.body.slice(0, 140), last_message_user_id: msg.user_id } : {}),
        });
      }
      return true;
    } catch (e) {
      stripTemp();
      if (uploaded.length > 0) await db.storage.from(COMMUNITY_BUCKET).remove(uploaded).catch(() => undefined);
      fail(e, "メッセージを送信できませんでした。");
      return false;
    }
  };

  const edit = async (msg: Message, text: string, known: KnownMention[]): Promise<boolean> => {
    const { body, mentions } = encodeMentions(text, known, false);
    if (!body.trim() && msg.attachments.length === 0) {
      pushToast({ kind: "error", title: "メッセージを入力してください。" });
      return false;
    }
    try {
      const updated = await api.editMessage(db, msg.id, body, mentions);
      prepareMessages([updated]);
      applyMessage(updated);
      return true;
    } catch (e) {
      fail(e, "編集できませんでした。");
      return false;
    }
  };

  const remove = async (msg: Message) => {
    try {
      await api.deleteMessage(db, msg.id);
      applyMessage({
        ...msg,
        body: "",
        attachments: [],
        mentions: [],
        reactions: {},
        is_pinned: false,
        deleted_at: new Date().toISOString(),
        deleted_by: get().me.id,
      });
      // スレッドの返信数は DB が更新し、Realtime で正しい値が届く（ここで減算すると二重になる）
    } catch (e) {
      fail(e, "削除できませんでした。");
    }
  };

  /** リアクションはすぐに表示へ反映し、失敗したら元に戻す。 */
  const react = async (msg: Message, emoji: string) => {
    const me = get().me.id;
    const current = findLoaded(msg.id) ?? get().threads[msg.parent_id ?? ""]?.items.find((m) => m.id === msg.id) ?? msg;
    const list = current.reactions[emoji] ?? [];
    const nextList = list.includes(me) ? list.filter((u) => u !== me) : [...list, me];
    const reactions = { ...current.reactions };
    if (nextList.length > 0) reactions[emoji] = nextList;
    else delete reactions[emoji];
    applyMessage({ ...current, reactions });
    try {
      const updated = await api.toggleReaction(db, msg.id, emoji);
      applyMessage(updated);
    } catch (e) {
      applyMessage(current);
      fail(e, "リアクションできませんでした。");
    }
  };

  const pin = async (msg: Message) => {
    try {
      const updated = await api.togglePin(db, msg.id);
      applyMessage(updated);
      pushToast({ kind: "info", title: updated.is_pinned ? "ピン留めしました。" : "ピン留めを外しました。" });
    } catch (e) {
      fail(e, "ピン留めできませんでした。");
    }
  };

  const report = async (msg: Message, reason: string): Promise<boolean> => {
    try {
      await api.reportMessage(db, msg.id, reason);
      pushToast({ kind: "info", title: "運営に通報しました。ご協力ありがとうございます。" });
      return true;
    } catch (e) {
      fail(e, "通報できませんでした。");
      return false;
    }
  };

  // ---------------------------------------------------------------- channel actions
  const join = async (channelId: string) => {
    patchChannel(channelId, { joined: true });
    try {
      await api.joinChannel(db, channelId);
      scheduleRefreshChannels();
    } catch (e) {
      patchChannel(channelId, { joined: false });
      fail(e, "参加できませんでした。");
    }
  };

  const leave = async (channelId: string) => {
    try {
      await api.leaveChannel(db, channelId);
      await refreshChannels();
      if (get().currentId === channelId) {
        const next = sortedJoinedChannels(get().channels).find((c) => c.id !== channelId);
        openChannel(next?.id ?? null);
      }
    } catch (e) {
      fail(e, "退出できませんでした。");
    }
  };

  const setNotify = async (channelId: string, level: NotifyLevel | "default") => {
    const prev = channelOf(channelId)?.notify ?? null;
    patchChannel(channelId, { notify: level === "default" ? null : level });
    try {
      await api.setPrefs(db, channelId, { notify: level });
      pushToast({ kind: "info", title: "通知設定を保存しました。" });
    } catch (e) {
      patchChannel(channelId, { notify: prev });
      fail(e, "設定を保存できませんでした。");
    }
  };

  const toggleStar = async (channelId: string) => {
    const ch = channelOf(channelId);
    if (!ch) return;
    patchChannel(channelId, { is_starred: !ch.is_starred });
    try {
      await api.setPrefs(db, channelId, { starred: !ch.is_starred });
    } catch (e) {
      patchChannel(channelId, { is_starred: ch.is_starred });
      fail(e, "設定を保存できませんでした。");
    }
  };

  const startDm = async (userId: string) => {
    try {
      const id = await api.openDm(db, userId);
      if (!channelOf(id)) await refreshChannels();
      else patchChannel(id, { joined: true });
      set({ view: get().view === "activity" ? "home" : get().view });
      openChannel(id);
    } catch (e) {
      fail(e, "ダイレクトメッセージを開けませんでした。");
    }
  };

  const createChannel = async (args: Parameters<typeof api.createChannel>[1]): Promise<string | null> => {
    try {
      const id = await api.createChannel(db, args);
      await refreshChannels();
      set({ view: "home" });
      openChannel(id);
      return id;
    } catch (e) {
      fail(e, "チャンネルを作成できませんでした。");
      return null;
    }
  };

  const updateChannel = async (
    channelId: string,
    patch: { name?: string | null; topic?: string | null; description?: string | null },
  ): Promise<boolean> => {
    try {
      await api.updateChannel(db, channelId, patch);
      await refreshChannels();
      return true;
    } catch (e) {
      fail(e, "チャンネルを更新できませんでした。");
      return false;
    }
  };

  const archiveChannel = async (channelId: string, archived: boolean): Promise<boolean> => {
    try {
      await api.setChannelArchived(db, channelId, archived);
      patchChannel(channelId, { is_archived: archived, can_post: archived ? false : channelOf(channelId)?.can_post ?? true });
      await refreshChannels();
      pushToast({ kind: "info", title: archived ? "チャンネルをアーカイブしました。" : "アーカイブを解除しました。" });
      return true;
    } catch (e) {
      fail(e, "チャンネルを更新できませんでした。");
      return false;
    }
  };

  const loadMembers = async (channelId: string, force = false) => {
    const cur = get().members[channelId];
    if (cur?.loading) return;
    if (!force && cur && Date.now() - cur.loadedAt < MEMBERS_TTL_MS) return;
    set((s) => ({
      members: {
        ...s.members,
        [channelId]: { total: cur?.total ?? 0, ids: cur?.ids ?? [], loading: true, loadedAt: cur?.loadedAt ?? 0 },
      },
    }));
    try {
      const list = await api.memberList(db, channelId);
      mergeUsers(list.users);
      set((s) => ({
        members: {
          ...s.members,
          [channelId]: { total: list.total, ids: list.users.map((u) => u.user_id), loading: false, loadedAt: Date.now() },
        },
      }));
    } catch {
      set((s) => ({
        members: { ...s.members, [channelId]: { ...(s.members[channelId] as MembersState), loading: false } },
      }));
    }
  };

  const inviteMembers = async (channelId: string, userIds: string[]): Promise<boolean> => {
    try {
      const n = await api.inviteMembers(db, channelId, userIds);
      pushToast({ kind: "info", title: n > 0 ? `${n}人をチャンネルに追加しました。` : "追加できるメンバーはいませんでした。" });
      void loadMembers(channelId, true);
      return true;
    } catch (e) {
      fail(e, "メンバーを追加できませんでした。");
      return false;
    }
  };

  const removeMember = async (channelId: string, userId: string) => {
    try {
      await api.removeMember(db, channelId, userId);
      void loadMembers(channelId, true);
      if (userId === get().me.id) await refreshChannels();
    } catch (e) {
      fail(e, "メンバーを外せませんでした。");
    }
  };

  // ---------------------------------------------------------------- activity
  const loadActivity = async (force = false) => {
    const cur = get().activity;
    if (cur.loading || (cur.loaded && !force)) return;
    set((s) => ({ activity: { ...s.activity, loading: true } }));
    try {
      const feed = await api.activity(db);
      mergeUsers(feed.users);
      prepareMessages(feed.items.map((i) => i.message));
      const seen = feed.seen_at ? Date.parse(feed.seen_at) : 0;
      set((s) => ({
        activity: {
          items: feed.items,
          seenAt: feed.seen_at,
          loaded: true,
          loading: false,
          unread: feed.items.filter((i) => Date.parse(i.message.created_at) > seen).length,
        },
      }));
    } catch {
      set((s) => ({ activity: { ...s.activity, loading: false } }));
    }
  };

  const markActivitySeen = async () => {
    set((s) => ({ activity: { ...s.activity, unread: 0 } }));
    try {
      const at = await api.markActivitySeen(db);
      set((s) => ({ activity: { ...s.activity, seenAt: at, unread: 0 } }));
    } catch {
      // 次回の確認で正しい値に戻る
    }
  };

  // ---------------------------------------------------------------- profile
  const saveProfile = async (args: { displayName: string; bio: string; allowDm: boolean }): Promise<boolean> => {
    try {
      const profile = await api.updateProfile(db, args);
      set((s) => ({
        me: { ...s.me, profile },
        users: {
          ...s.users,
          [profile.user_id]: {
            ...(s.users[profile.user_id] ?? { real_name: null }),
            user_id: profile.user_id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url,
            bio: profile.bio,
            is_staff: profile.is_staff,
          } as UserInfo,
        },
      }));
      pushToast({ kind: "info", title: "プロフィールを保存しました。" });
      return true;
    } catch (e) {
      fail(e, "プロフィールを保存できませんでした。");
      return false;
    }
  };

  /** 既読のメンバー（チャンネルの「既読 N」を押したとき） */
  const readersOf = (msg: Message): string[] => {
    const created = Date.parse(msg.created_at);
    return Object.entries(get().receipts)
      .filter(([uid, at]) => uid !== msg.user_id && Date.parse(at) >= created)
      .map(([uid]) => uid);
  };

  return {
    db,
    getState: get,
    readersOf,
    drafts,
    nameOf,
    channelOf,
    pushToast,
    dismissToast,
    ensureUsers,
    mergeUsers,
    ensureSigned,
    prepareMessages,
    refreshChannels,
    scheduleRefreshChannels,
    doMarkRead,
    openChannel,
    setView,
    setMobileView,
    prefetch,
    loadChannel,
    loadOlder,
    openThread,
    jumpTo,
    requestNotificationPermission,
    onInsert,
    onUpdate,
    resync,
    setTypingChannel,
    notifyTyping,
    onTyping,
    expireTyping,
    send,
    edit,
    remove,
    react,
    pin,
    report,
    join,
    leave,
    setNotify,
    toggleStar,
    startDm,
    createChannel,
    updateChannel,
    archiveChannel,
    loadMembers,
    inviteMembers,
    removeMember,
    loadActivity,
    markActivitySeen,
    saveProfile,
  };
}

// ---------------------------------------------------------------------------
// Provider（Realtime の購読・画面の状態に応じた処理）
// ---------------------------------------------------------------------------

export function CommunityProvider({
  init,
  explicitChannel,
  initialDmUserId,
  initialMessageId,
  seed,
  children,
}: {
  init: InitPayload;
  /** URL でチャンネルが指定された（スマホでも一覧ではなくチャンネルから始める） */
  explicitChannel: boolean;
  initialDmUserId: string | null;
  initialMessageId: string | null;
  /** 表示確認（プレビュー）用に初期状態の一部を上書きする */
  seed?: Partial<State>;
  children: ReactNode;
}) {
  const storeRef = useRef<Store | null>(null);
  if (!storeRef.current) storeRef.current = new Store({ ...initialState(init, explicitChannel), ...seed });
  const store = storeRef.current;
  const actions = useMemo(() => createActions(store, getSupabaseBrowserClient()), [store]);
  const meId = store.get().me.id;
  const currentId = useSyncExternalStore(store.subscribe, () => store.get().currentId, () => store.get().currentId);
  const hasTyping = useSyncExternalStore(
    store.subscribe,
    () => Object.values(store.get().typing).some((m) => Object.keys(m).length > 0),
    () => false,
  );

  // ---------------------------------------------------------------- first mount
  useEffect(() => {
    const s = store.get();
    if (typeof window !== "undefined" && "Notification" in window) {
      store.set({ notificationPermission: Notification.permission });
    }
    // 表示に必要な添付・未取得のユーザーを補う
    for (const st of Object.values(s.messages)) actions.prepareMessages(st.items);
    actions.ensureUsers(s.channels.flatMap((r) => [r.dm_user_id, r.last_message_user_id]));

    const cur = s.currentId;
    if (cur && (explicitChannel || isDesktopWidth())) {
      rememberChannel(cur);
      if (isPageVisible()) void actions.doMarkRead(cur);
    }
    if (initialDmUserId) void actions.startDm(initialDmUserId);
    if (initialMessageId) {
      void api
        .loadMessage(actions.db, initialMessageId)
        .then((msg) => msg && actions.jumpTo(msg))
        .catch(() => undefined);
    }
    // 少し待ってから、アクティビティの未確認数と未読のあるチャンネルを先読みする
    const idle = setTimeout(() => {
      void actions.loadActivity();
      const unread = store
        .get()
        .channels.filter((c) => c.joined && c.id !== store.get().currentId && badgeCount(c) > 0)
        .slice(0, 3);
      unread.forEach((c) => actions.prefetch(c.id));
    }, 1500);
    return () => clearTimeout(idle);
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- realtime: messages & channels & my memberships
  useEffect(() => {
    const db = actions.db;
    let subscribedOnce = false;
    const channel = db
      .channel("community-db")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_messages" }, (p) =>
        actions.onInsert(p.new),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "community_messages" }, (p) =>
        actions.onUpdate(p.new),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "community_channels" }, () =>
        actions.scheduleRefreshChannels(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "community_channel_members", filter: `user_id=eq.${meId}` },
        () => actions.scheduleRefreshChannels(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // 切断中に届いたメッセージを取りこぼさないよう、再接続時に取り直す
          if (subscribedOnce) void actions.resync();
          subscribedOnce = true;
        }
      });
    return () => {
      void db.removeChannel(channel);
    };
  }, [actions, meId]);

  // ---------------------------------------------------------------- realtime: read receipts of the open channel
  useEffect(() => {
    store.set({ receipts: {} });
    if (!currentId) return;
    const db = actions.db;
    let active = true;
    api.loadReceipts(db, currentId).then((r) => {
      if (active) store.set({ receipts: r });
    });
    const channel = db
      .channel(`community-read-${currentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "community_channel_members", filter: `channel_id=eq.${currentId}` },
        (p) => {
          const row = p.new as { user_id?: string; last_read_at?: string | null } | undefined;
          if (row?.user_id && row.last_read_at) {
            const uid = row.user_id;
            const at = row.last_read_at;
            store.set((s) => (s.receipts[uid] === at ? null : { receipts: { ...s.receipts, [uid]: at } }));
          }
        },
      )
      .subscribe();
    return () => {
      active = false;
      void db.removeChannel(channel);
    };
  }, [actions, store, currentId]);

  // ---------------------------------------------------------------- realtime: typing indicator (private broadcast)
  useEffect(() => {
    actions.setTypingChannel(null);
    if (!currentId) return;
    const db = actions.db;
    const channel = db.channel(`community:typing:${currentId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "typing" }, (p) => {
        const uid = (p.payload as { user_id?: string } | undefined)?.user_id;
        if (uid) actions.onTyping(currentId, uid);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") actions.setTypingChannel(channel);
        if (status === "CHANNEL_ERROR") void db.removeChannel(channel);
      });
    return () => {
      actions.setTypingChannel(null);
      void db.removeChannel(channel);
    };
  }, [actions, currentId]);

  // 入力中表示の期限切れを反映する
  useEffect(() => {
    if (!hasTyping) return;
    const t = setInterval(() => actions.expireTyping(), 1500);
    return () => clearInterval(t);
  }, [actions, hasTyping]);

  // ---------------------------------------------------------------- realtime: presence (online)
  useEffect(() => {
    const db = actions.db;
    const channel = db.channel("community:presence", {
      config: { private: true, presence: { key: meId } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        const next = new Set(Object.keys(channel.presenceState()));
        store.set((s) =>
          s.online.size === next.size && Array.from(next).every((id) => s.online.has(id)) ? null : { online: next },
        );
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track({ online_at: new Date().toISOString() });
        if (status === "CHANNEL_ERROR") void db.removeChannel(channel);
      });
    return () => {
      void db.removeChannel(channel);
    };
  }, [actions, store, meId]);

  // ---------------------------------------------------------------- signed URL refresh
  useEffect(() => {
    const t = setInterval(() => {
      const paths: string[] = [];
      for (const st of Object.values(store.get().messages)) {
        for (const m of st.items) for (const a of m.attachments) paths.push(a.path);
      }
      actions.ensureSigned(paths);
    }, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [actions, store]);

  // 画面に戻ったら、開いているチャンネルを既読にし、一覧を最新化する
  useEffect(() => {
    const onVisible = () => {
      if (!isPageVisible()) return;
      const s = store.get();
      const ch = s.channels.find((c) => c.id === s.currentId);
      if (ch && ch.unread_count > 0 && (s.mobileView === "channel" || isDesktopWidth())) void actions.doMarkRead(ch.id);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") actions.scheduleRefreshChannels();
      onVisible();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [actions, store]);

  return (
    <StoreCtx.Provider value={store}>
      <ActionsCtx.Provider value={actions}>
        <TitleBadge />
        {children}
      </ActionsCtx.Provider>
    </StoreCtx.Provider>
  );
}

/** タブのタイトルに未読数を出す。 */
function TitleBadge() {
  const total = useCS((s) => s.channels.filter((c) => c.joined).reduce((sum, c) => sum + badgeCount(c), 0));
  useEffect(() => {
    const base = "Retouch コミュニティ";
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${base}` : base;
  }, [total]);
  return null;
}
