"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  badgeCount,
  effectiveNotify,
  formatDayLabel,
  formatTime,
  isPrivateChannel,
  plainText,
  sortChannels,
  sortDms,
} from "@/lib/community/text";
import type { ActivityItem, ChannelRow } from "@/lib/community/types";
import Avatar from "./Avatar";
import { Icon } from "./icons";
import { shallowArray, useActions, useChannel, useCS, useMe, useName, useNameOf } from "./store";
import { useOpenModal } from "./ui";

// ---------------------------------------------------------------------------
// 共通パーツ
// ---------------------------------------------------------------------------

export function Badge({ n, className = "" }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-sk-badge px-[5px] text-[12px] font-bold leading-none text-white tabular-nums ${className}`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** チャンネルの記号（# / 鍵 / アーカイブ） */
export function ChannelGlyph({ ch, className = "w-[15px] h-[15px]" }: { ch: ChannelRow; className?: string }) {
  if (ch.is_archived) return <Icon name="archive" className={className} />;
  if (isPrivateChannel(ch)) return <Icon name="lock" className={className} strokeWidth={2.2} />;
  return <Icon name="hash" className={className} strokeWidth={2.2} />;
}

function useSectionOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(`community:section:${key}`) === "0") setOpen(false);
    } catch {
      // 既定（開く）のまま
    }
  }, [key]);
  const toggle = () =>
    setOpen((v) => {
      try {
        window.localStorage.setItem(`community:section:${key}`, v ? "0" : "1");
      } catch {
        // 記憶できなくても切り替えはできる
      }
      return !v;
    });
  return [open, toggle];
}

function Menu({
  onClose,
  className = "",
  children,
}: {
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      className={`z-[130] min-w-[240px] rounded-[8px] border border-sk-line bg-white py-2 text-[15px] text-sk-text shadow-[0_4px_12px_rgba(0,0,0,0.15)] ${className}`}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  danger = false,
  href,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
  href?: string;
}) {
  const cls = `flex w-full items-center gap-2 px-6 py-1.5 text-left ${
    danger ? "text-[#E01E5A] hover:bg-[#E01E5A] hover:text-white" : "hover:bg-sk-active hover:text-white"
  }`;
  if (href) {
    return (
      <Link href={href} role="menuitem" className={cls} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}

export { Menu };

// ---------------------------------------------------------------------------
// ホーム（チャンネル・DM の一覧）
// ---------------------------------------------------------------------------

const ChannelItem = memo(function ChannelItem({ id }: { id: string }) {
  const ch = useChannel(id);
  const active = useCS((s) => s.currentId === id);
  const meId = useCS((s) => s.me.id);
  const dmName = useName(ch?.kind === "dm" ? ch.dm_user_id : null);
  const actions = useActions();
  if (!ch) return null;
  const muted = effectiveNotify(ch) === "none";
  const unread = ch.unread_count > 0 && !muted;
  const count = badgeCount(ch);
  const isDm = ch.kind === "dm";
  const label = isDm ? (ch.dm_user_id === meId ? `${dmName}（自分）` : dmName) : ch.name;

  return (
    <li>
      <button
        type="button"
        onClick={() => actions.openChannel(ch.id)}
        onMouseEnter={() => actions.prefetch(ch.id)}
        onFocus={() => actions.prefetch(ch.id)}
        aria-current={active ? "page" : undefined}
        className={`mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-[6px] pl-[18px] pr-2 text-left text-[15px] leading-7 ${
          active
            ? "bg-sk-active text-white"
            : unread
              ? "font-bold text-white hover:bg-sk-hover"
              : muted
                ? "text-white/40 hover:bg-sk-hover"
                : "text-white/70 hover:bg-sk-hover"
        }`}
      >
        {isDm ? (
          <Avatar userId={ch.dm_user_id} size={20} showOnline ring="side" />
        ) : (
          <span className="flex w-5 justify-center opacity-90">
            <ChannelGlyph ch={ch} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count > 0 ? (
          <Badge n={count} />
        ) : muted ? (
          <Icon name="bellOff" className="w-3.5 h-3.5 opacity-60" />
        ) : null}
      </button>
    </li>
  );
});

function Section({
  id,
  title,
  children,
  addLabel,
  onAdd,
  addMenu,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  addLabel?: string;
  onAdd?: () => void;
  addMenu?: React.ReactNode;
}) {
  const [open, toggle] = useSectionOpen(id);
  const [menu, setMenu] = useState(false);
  return (
    <section className="mt-3 first:mt-2">
      <div className="group mx-2 flex h-7 items-center rounded-[6px] hover:bg-sk-hover">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex h-7 min-w-0 flex-1 items-center gap-1 px-1.5 text-left text-[15px] text-white/70"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-[4px] hover:bg-white/10">
            <Icon name={open ? "caretDown" : "caretRight"} className="w-4 h-4" strokeWidth={2.5} />
          </span>
          <span className="truncate">{title}</span>
        </button>
      </div>
      {open && <ul className="mt-0.5 space-y-[1px]">{children}</ul>}
      {addLabel && (
        <div className="relative">
          <button
            type="button"
            onClick={() => (addMenu ? setMenu((v) => !v) : onAdd?.())}
            className="mx-2 mt-[1px] flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-[6px] pl-[18px] pr-2 text-left text-[15px] text-white/70 hover:bg-sk-hover"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-white/10">
              <Icon name="plus" className="w-3.5 h-3.5" strokeWidth={2.5} />
            </span>
            {addLabel}
          </button>
          {menu && addMenu && (
            <Menu onClose={() => setMenu(false)} className="absolute left-4 top-8">
              <div onClick={() => setMenu(false)}>{addMenu}</div>
            </Menu>
          )}
        </div>
      )}
    </section>
  );
}

function WorkspaceHeader() {
  const me = useMe();
  const openModal = useOpenModal();
  const permission = useCS((s) => s.notificationPermission);
  const actions = useActions();
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative flex h-[49px] shrink-0 items-center gap-2 border-b border-white/10 px-4">
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        className="flex min-w-0 items-center gap-1 rounded-[6px] px-1.5 py-1 -ml-1.5 text-[18px] font-black text-white hover:bg-sk-hover"
        aria-haspopup="menu"
        aria-expanded={menu}
      >
        <span className="truncate">Retouch</span>
        <Icon name="caretDown" className="w-4 h-4" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        onClick={() => openModal({ type: "search", channelId: null })}
        className="md:hidden ml-auto flex h-[34px] w-[34px] items-center justify-center rounded-[8px] text-white hover:bg-sk-hover"
        aria-label="検索"
        title="検索"
      >
        <Icon name="search" className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => openModal({ type: "directory" })}
        className="md:ml-auto flex h-[34px] w-[34px] items-center justify-center rounded-[8px] bg-white text-sk-side hover:bg-white/90"
        aria-label="新しいメッセージ"
        title="新しいメッセージ"
      >
        <Icon name="compose" className="w-[18px] h-[18px]" />
      </button>
      {menu && (
        <Menu onClose={() => setMenu(false)} className="absolute left-3 top-12">
          <div className="flex items-center gap-3 px-6 pb-3 pt-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-96.png" alt="" className="h-9 w-9 rounded-[8px] bg-white object-contain" />
            <div>
              <p className="font-black">Retouch</p>
              <p className="text-[13px] text-sk-mute">会員専用コミュニティ</p>
            </div>
          </div>
          <div className="my-1 border-t border-sk-line" />
          <MenuItem
            onClick={() => {
              setMenu(false);
              openModal({ type: "create" });
            }}
          >
            チャンネルを作成する
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(false);
              openModal({ type: "browse" });
            }}
          >
            チャンネル一覧
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(false);
              openModal({ type: "profile" });
            }}
          >
            プロフィールを編集
          </MenuItem>
          {permission === "default" && (
            <MenuItem
              onClick={() => {
                setMenu(false);
                void actions.requestNotificationPermission();
              }}
            >
              デスクトップ通知を有効にする
            </MenuItem>
          )}
          <div className="my-1 border-t border-sk-line" />
          {me.isStaff && <MenuItem href="/admin/community">コミュニティ管理</MenuItem>}
          <MenuItem href={me.isStaff ? "/admin" : "/mypage"}>{me.isStaff ? "管理画面に戻る" : "マイページに戻る"}</MenuItem>
        </Menu>
      )}
    </div>
  );
}

function HomePanel() {
  const openModal = useOpenModal();
  const joined = useCS(
    (s) => s.channels.filter((c) => c.joined),
    shallowArray,
  );
  const permission = useCS((s) => s.notificationPermission);
  const actions = useActions();
  const { starred, chans, dms } = useMemo(() => {
    const starredList = joined.filter((c) => c.is_starred);
    return {
      starred: [...sortChannels(starredList.filter((c) => c.kind === "channel")), ...sortDms(starredList.filter((c) => c.kind === "dm"))],
      chans: sortChannels(joined.filter((c) => c.kind === "channel" && !c.is_starred)),
      dms: sortDms(joined.filter((c) => c.kind === "dm" && !c.is_starred)),
    };
  }, [joined]);

  return (
    <>
      <WorkspaceHeader />
      <nav className="flex-1 min-h-0 overflow-y-auto pb-6 sk-scroll" aria-label="チャンネルとダイレクトメッセージ">
        {permission === "default" && (
          <button
            type="button"
            onClick={() => void actions.requestNotificationPermission()}
            className="mx-3 mt-3 flex w-[calc(100%-24px)] items-center gap-2 rounded-[8px] bg-white/10 px-3 py-2 text-left text-[13px] text-white/90 hover:bg-white/15"
          >
            <Icon name="bell" className="w-4 h-4" />
            デスクトップ通知を有効にする
          </button>
        )}
        {starred.length > 0 && (
          <Section id="starred" title="スター付き">
            {starred.map((c) => (
              <ChannelItem key={c.id} id={c.id} />
            ))}
          </Section>
        )}
        <Section
          id="channels"
          title="チャンネル"
          addLabel="チャンネルを追加する"
          addMenu={
            <>
              <MenuItem onClick={() => openModal({ type: "create" })}>新しいチャンネルを作成する</MenuItem>
              <MenuItem onClick={() => openModal({ type: "browse" })}>チャンネル一覧を見る</MenuItem>
            </>
          }
        >
          {chans.map((c) => (
            <ChannelItem key={c.id} id={c.id} />
          ))}
        </Section>
        <Section
          id="dms"
          title="ダイレクトメッセージ"
          addLabel="メッセージを送る"
          onAdd={() => openModal({ type: "directory" })}
        >
          {dms.map((c) => (
            <ChannelItem key={c.id} id={c.id} />
          ))}
        </Section>
      </nav>
    </>
  );
}

// ---------------------------------------------------------------------------
// DM（Slack の「DM」タブ）
// ---------------------------------------------------------------------------

const DmRow = memo(function DmRow({ id }: { id: string }) {
  const ch = useChannel(id);
  const active = useCS((s) => s.currentId === id);
  const meId = useCS((s) => s.me.id);
  const name = useName(ch?.dm_user_id);
  const nameOf = useNameOf();
  const actions = useActions();
  if (!ch) return null;
  const count = badgeCount(ch);
  const self = ch.dm_user_id === meId;
  const at = ch.last_message_at ?? ch.created_at;
  const preview = ch.last_message_preview
    ? `${ch.last_message_user_id === meId ? "あなた: " : ""}${plainText(ch.last_message_preview, nameOf, 80)}`
    : "メッセージはまだありません";
  return (
    <li>
      <button
        type="button"
        onClick={() => actions.openChannel(ch.id)}
        onMouseEnter={() => actions.prefetch(ch.id)}
        className={`mx-2 flex w-[calc(100%-16px)] items-start gap-3 rounded-[8px] px-3 py-2.5 text-left ${
          active ? "bg-sk-active" : "hover:bg-sk-hover"
        }`}
      >
        <Avatar userId={ch.dm_user_id} size={36} showOnline ring="side" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-[15px] ${count > 0 ? "font-black text-white" : "font-bold text-white/90"}`}>
              {self ? `${name}（自分）` : name}
            </span>
            <span className="shrink-0 text-[12px] text-white/60">
              {formatDayLabel(at) === "今日" ? formatTime(at) : formatDayLabel(at)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[13px] ${count > 0 ? "text-white" : "text-white/60"}`}>{preview}</span>
            <Badge n={count} />
          </span>
        </span>
      </button>
    </li>
  );
});

function DmPanel() {
  const openModal = useOpenModal();
  const [q, setQ] = useState("");
  const dms = useCS((s) => s.channels.filter((c) => c.kind === "dm" && c.joined), shallowArray);
  const nameOf = useNameOf();
  const list = useMemo(() => {
    const sorted = sortDms(dms);
    const t = q.trim();
    return t ? sorted.filter((c) => nameOf(c.dm_user_id).includes(t)) : sorted;
  }, [dms, q, nameOf]);
  return (
    <>
      <div className="flex h-[49px] shrink-0 items-center gap-2 border-b border-white/10 px-4">
        <h2 className="flex-1 truncate text-[18px] font-black text-white">ダイレクトメッセージ</h2>
        <button
          type="button"
          onClick={() => openModal({ type: "directory" })}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[8px] bg-white text-sk-side hover:bg-white/90"
          aria-label="新しいメッセージ"
          title="新しいメッセージ"
        >
          <Icon name="compose" />
        </button>
      </div>
      <div className="px-3 pt-3">
        <label className="flex h-8 items-center gap-2 rounded-[6px] bg-white/10 px-2 text-white/70 focus-within:bg-white/20">
          <Icon name="search" className="w-4 h-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="DM を検索"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/60"
          />
        </label>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto py-2 space-y-0.5 sk-scroll">
        {list.map((c) => (
          <DmRow key={c.id} id={c.id} />
        ))}
        {list.length === 0 && <li className="px-5 py-6 text-center text-[13px] text-white/60">ダイレクトメッセージはありません</li>}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// アクティビティ（メンション・スレッドの返信）
// ---------------------------------------------------------------------------

const REASON_LABEL: Record<ActivityItem["reason"], string> = {
  mention: "あなたをメンション",
  channel: "@channel",
  reply: "スレッドへの返信",
};

function ActivityRow({ item, unread }: { item: ActivityItem; unread: boolean }) {
  const actions = useActions();
  const ch = useChannel(item.message.channel_id);
  const author = useName(item.message.user_id);
  const nameOf = useNameOf();
  const m = item.message;
  return (
    <li>
      <button
        type="button"
        onClick={() => void actions.jumpTo(m)}
        className="mx-2 flex w-[calc(100%-16px)] items-start gap-3 rounded-[8px] px-3 py-2.5 text-left hover:bg-sk-hover"
      >
        <span className="relative">
          <Avatar userId={m.user_id} size={36} ring="side" />
          <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-2 border-sk-side bg-white text-sk-side">
            <Icon name={item.reason === "reply" ? "thread" : "at"} className="w-3 h-3" strokeWidth={2.5} />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 text-[12px] text-white/60">
            <span className="min-w-0 flex-1 truncate">
              {REASON_LABEL[item.reason]}・#{ch?.name ?? ""}
            </span>
            <span className="shrink-0">{formatDayLabel(m.created_at) === "今日" ? formatTime(m.created_at) : formatDayLabel(m.created_at)}</span>
          </span>
          <span className={`block truncate text-[15px] ${unread ? "font-black text-white" : "font-bold text-white/90"}`}>{author}</span>
          <span className="text-[13px] leading-snug text-white/70 line-clamp-2">
            {plainText(m.body, nameOf, 140) || (m.attachments.length > 0 ? "📎 ファイル" : "")}
          </span>
        </span>
        {unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-[999px] bg-[#1D9BD1]" aria-label="未読" />}
      </button>
    </li>
  );
}

function ActivityPanel() {
  const activity = useCS((s) => s.activity);
  const [tab, setTab] = useState<"all" | "mention" | "reply">("all");
  const seen = activity.seenAt ? Date.parse(activity.seenAt) : 0;
  // 開いたときの未読（確認済みにした後も、この画面を開いている間は印を残す）
  const unreadSince = useRef(seen);
  const items = activity.items.filter((i) =>
    tab === "all" ? true : tab === "mention" ? i.reason !== "reply" : i.reason === "reply",
  );
  return (
    <>
      <div className="flex h-[49px] shrink-0 items-center border-b border-white/10 px-4">
        <h2 className="flex-1 truncate text-[18px] font-black text-white">アクティビティ</h2>
      </div>
      <div className="flex gap-1 overflow-x-auto px-3 pt-3" role="tablist">
        {(
          [
            ["all", "すべて"],
            ["mention", "@メンション"],
            ["reply", "スレッド"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`h-7 shrink-0 whitespace-nowrap rounded-[14px] px-2.5 text-[12px] font-bold ${
              tab === k ? "bg-white text-sk-side" : "bg-white/10 text-white/80 hover:bg-white/20"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto py-2 space-y-0.5 sk-scroll">
        {activity.loading && !activity.loaded && (
          <li className="px-5 py-6 text-center text-[13px] text-white/60 animate-pulse">読み込み中…</li>
        )}
        {items.map((i) => (
          <ActivityRow key={i.message.id} item={i} unread={Date.parse(i.message.created_at) > unreadSince.current} />
        ))}
        {activity.loaded && items.length === 0 && (
          <li className="px-5 py-10 text-center text-[13px] text-white/60">
            直近30日のメンションやスレッドへの返信はありません
          </li>
        )}
      </ul>
    </>
  );
}

/** 左の一覧パネル（Slack のサイドバー）。表示中のタブ（ホーム・DM・アクティビティ）で中身が変わる。 */
export default function Sidebar({ className = "" }: { className?: string }) {
  const view = useCS((s) => s.view);
  return (
    <aside className={`flex-col min-h-0 bg-sk-side text-white ${className}`}>
      {view === "dms" ? <DmPanel /> : view === "activity" ? <ActivityPanel /> : <HomePanel />}
    </aside>
  );
}
