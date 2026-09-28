"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { Emoji } from "./Emoji";
import { Icon, type IconName } from "./icons";
import { shallowArray, useActions, useChannel, useCS, useMe, useName, useNameOf, type View } from "./store";
import { useOpenModal } from "./ui";

// ---------------------------------------------------------------------------
// 共通パーツ
// ---------------------------------------------------------------------------

export function Badge({ n, className = "" }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#E5484D] px-[6px] text-[11px] font-bold leading-none text-white tabular-nums ${className}`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** アイコンの値が画像（VPS のパスまたは URL）か */
export function isImageIcon(icon: string | null | undefined): icon is string {
  return !!icon && (icon.startsWith("/uploads/") || /^https?:\/\//.test(icon) || icon.startsWith("blob:"));
}

/** アイコン（画像または絵文字）を指定の大きさで表示する */
export function ChannelIconView({ icon, size, className = "" }: { icon: string; size: number; className?: string }) {
  if (isImageIcon(icon)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={`inline-block shrink-0 object-cover ${className}`}
        style={{ width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.28)) }}
      />
    );
  }
  return <Emoji emoji={icon} size={size} className={className} />;
}

/**
 * チャンネルの記号。アイコンが設定されていればその画像・絵文字、無ければ # / 鍵。
 * アーカイブ済みはアーカイブのマーク。size はアイコン（画像・絵文字）の大きさ。
 */
export function ChannelGlyph({
  ch,
  className = "w-[15px] h-[15px]",
  size = 16,
}: {
  ch: ChannelRow;
  className?: string;
  size?: number;
}) {
  if (ch.is_archived) return <Icon name="archive" className={className} />;
  if (ch.kind === "channel" && ch.icon) return <ChannelIconView icon={ch.icon} size={size} />;
  if (isPrivateChannel(ch)) return <Icon name="lock" className={className} strokeWidth={2.2} />;
  return <Icon name="hash" className={className} strokeWidth={2.2} />;
}

/** 未読数（ホーム・DM・アクティビティの切り替えタブとスマホ下部のタブで使う） */
export function useUnreadTotals() {
  const dm = useCS((s) =>
    s.channels.filter((c) => c.kind === "dm" && c.joined && c.notify !== "none").reduce((n, c) => n + c.unread_count, 0),
  );
  // ホーム: 参加中のチャンネル（ミュートを除く）に他の人から届いた未読の合計
  const homeCount = useCS((s) =>
    s.channels
      .filter((c) => c.kind === "channel" && c.joined && c.notify !== "none")
      .reduce((n, c) => n + c.unread_count, 0),
  );
  const activity = useCS((s) => s.activity.unread);
  return { dm, home: homeCount > 0, homeCount, activity };
}

/** 一覧に出す未読数（他の人から届いた未読。ミュートしたチャンネル・DM は 0） */
function unreadOf(ch: ChannelRow): number {
  return effectiveNotify(ch) === "none" ? 0 : ch.unread_count;
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
      className={`z-[130] min-w-[240px] rounded-[16px] border border-[#E2E9E4] bg-white p-1.5 text-[14px] text-sk-text shadow-[0_16px_40px_rgba(30,43,36,0.16)] ${className}`}
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
  icon,
  hint,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
  href?: string;
  /** 左に出すアイコン */
  icon?: IconName;
  /** 右に出すショートカットや補足（例: "E"） */
  hint?: React.ReactNode;
}) {
  const cls = `group/item flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition-colors ${
    danger ? "text-[#D2475E] hover:bg-[#FBE7EA]" : "hover:bg-[#E3F0E8] hover:text-[#22553F]"
  }`;
  const inner = (
    <>
      {icon && <Icon name={icon} className="w-4 h-4 shrink-0 opacity-80" />}
      <span className="min-w-0 flex-1">{children}</span>
      {hint != null && (
        <span className={`ml-4 shrink-0 text-[11px] tabular-nums ${danger ? "text-[#D2475E99]" : "text-[#9AA59E] group-hover/item:text-[#2D6A4F]"}`}>
          {hint}
        </span>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} role="menuitem" className={cls} onClick={onClick}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

export { Menu };

// ---------------------------------------------------------------------------
// 上部（ロゴ・検索・ホーム / DM / アクティビティの切り替え）
// ---------------------------------------------------------------------------

function BrandHeader() {
  const me = useMe();
  const openModal = useOpenModal();
  const permission = useCS((s) => s.notificationPermission);
  const actions = useActions();
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative flex h-[60px] shrink-0 items-center gap-2 px-4">
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        className="-ml-1.5 flex min-w-0 items-center gap-2.5 rounded-[12px] px-1.5 py-1 text-left transition-colors hover:bg-white"
        aria-haspopup="menu"
        aria-expanded={menu}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-96.png" alt="" className="h-9 w-9 rounded-[12px] bg-white object-contain p-0.5 ring-1 ring-[#E2E9E4]" />
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-[16px] font-bold text-sk-text">
            <span className="truncate">Retouch</span>
            <Icon name="caretDown" className="w-3.5 h-3.5 text-sk-mute" strokeWidth={2.5} />
          </span>
          <span className="block text-[11px] text-sk-mute">会員コミュニティ</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => openModal({ type: "search", channelId: null })}
        className="md:hidden ml-auto flex h-9 w-9 items-center justify-center rounded-full text-sk-mute transition-colors hover:bg-white hover:text-sk-text"
        aria-label="検索"
        title="検索"
      >
        <Icon name="search" className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => openModal({ type: "directory" })}
        className="md:ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-[#D5E2D9] bg-white text-[#2D6A4F] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(45,106,79,0.18)]"
        aria-label="新しいメッセージ"
        title="新しいメッセージ"
      >
        <Icon name="compose" className="w-[17px] h-[17px]" />
      </button>
      {menu && (
        <Menu onClose={() => setMenu(false)} className="absolute left-3 top-14">
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

function SearchField() {
  const openModal = useOpenModal();
  return (
    <div className="hidden md:block shrink-0 px-4 pb-3">
      <button
        type="button"
        onClick={() => openModal({ type: "search", channelId: null })}
        className="flex h-9 w-full items-center gap-2 rounded-full border border-[#E2E9E4] bg-white px-3.5 text-left text-[13px] text-sk-mute transition-colors hover:border-[#C7D8CD]"
      >
        <Icon name="search" className="w-4 h-4" />
        メッセージ・チャンネルを検索
      </button>
    </div>
  );
}

function ViewTabs() {
  const view = useCS((s) => s.view);
  const actions = useActions();
  const u = useUnreadTotals();
  const tabs: { key: View; icon: IconName; label: string; badge?: number; dot?: boolean }[] = [
    { key: "home", icon: "home", label: "ホーム", badge: u.homeCount },
    { key: "dms", icon: "dm", label: "DM", badge: u.dm },
    { key: "activity", icon: "bell", label: "通知", badge: u.activity },
  ];
  return (
    <div className="hidden md:flex shrink-0 px-4 pb-2" role="tablist" aria-label="表示の切り替え">
      <div className="flex w-full gap-1 rounded-[14px] bg-[#E6EEE8] p-1">
        {tabs.map((t) => {
          const active = view === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => actions.setView(t.key)}
              className={`relative flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-bold transition-all duration-200 ${
                active ? "bg-white text-[#2D6A4F] shadow-[0_1px_3px_rgba(30,43,36,0.12)]" : "text-sk-mute hover:text-sk-text"
              }`}
            >
              <Icon name={t.icon} className="w-4 h-4" strokeWidth={active ? 2.4 : 2} />
              {t.label}
              {t.badge ? (
                <Badge n={t.badge} className="rc-badge-pulse ml-0.5" />
              ) : t.dot ? (
                <span className="h-1.5 w-1.5 rounded-full bg-[#E0782F]" aria-label="未読あり" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const count = unreadOf(ch);
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
        className={`group relative mx-3 flex h-8 w-[calc(100%-24px)] items-center gap-2 rounded-[10px] pl-3 pr-2 text-left text-[14px] transition-all duration-150 ${
          active
            ? "bg-white font-bold text-[#2D6A4F] shadow-[0_1px_3px_rgba(30,43,36,0.10)]"
            : unread
              ? "font-bold text-sk-text hover:bg-white/80 hover:pl-3.5"
              : muted
                ? "text-[#1E2B2466] hover:bg-white/80 hover:pl-3.5"
                : "text-[#3F4E45] hover:bg-white/80 hover:pl-3.5"
        }`}
      >
        {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[#2D6A4F]" aria-hidden />}
        {isDm ? (
          <Avatar userId={ch.dm_user_id} size={20} showOnline ring="side" />
        ) : (
          <span className={`flex w-5 justify-center ${active ? "text-[#2D6A4F]" : "text-[#8A968F]"}`}>
            <ChannelGlyph ch={ch} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count > 0 ? (
          <Badge n={count} />
        ) : unread ? (
          <span className="h-2 w-2 rounded-full bg-[#E0782F]" aria-label="未読あり" />
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
    <section className="mt-4 first:mt-1">
      <div className="relative mx-3 flex h-7 items-center">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[8px] px-1 text-left text-[11px] font-bold tracking-[0.08em] text-[#7A877F] transition-colors hover:text-sk-text"
        >
          <Icon
            name="caretDown"
            className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
            strokeWidth={2.5}
          />
          <span className="truncate">{title}</span>
        </button>
        {addLabel && (
          <button
            type="button"
            onClick={() => (addMenu ? setMenu((v) => !v) : onAdd?.())}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[#7A877F] transition-all hover:rotate-90 hover:bg-white hover:text-[#2D6A4F]"
            aria-label={addLabel}
            title={addLabel}
          >
            <Icon name="plus" className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        )}
        {menu && addMenu && (
          <Menu onClose={() => setMenu(false)} className="absolute right-0 top-8">
            <div onClick={() => setMenu(false)}>{addMenu}</div>
          </Menu>
        )}
      </div>
      {open && <ul className="mt-1 space-y-0.5">{children}</ul>}
    </section>
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
    <nav className="flex-1 min-h-0 overflow-y-auto pb-4 sk-scroll" aria-label="チャンネルとダイレクトメッセージ">
      {permission === "default" && (
        <button
          type="button"
          onClick={() => void actions.requestNotificationPermission()}
          className="mx-3 mb-2 mt-1 flex w-[calc(100%-24px)] items-center gap-2.5 rounded-[12px] border border-[#F3D9B5] bg-[#FFF6E5] px-3 py-2 text-left text-[12px] font-bold text-[#8A5A14] transition-colors hover:bg-[#FFEFD2]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
            <Icon name="bell" className="w-3.5 h-3.5" />
          </span>
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
      <Section id="dms" title="ダイレクトメッセージ" addLabel="メッセージを送る" onAdd={() => openModal({ type: "directory" })}>
        {dms.map((c) => (
          <ChannelItem key={c.id} id={c.id} />
        ))}
      </Section>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// DM
// ---------------------------------------------------------------------------

const DmRow = memo(function DmRow({ id }: { id: string }) {
  const ch = useChannel(id);
  const active = useCS((s) => s.currentId === id);
  const meId = useCS((s) => s.me.id);
  const name = useName(ch?.dm_user_id);
  const nameOf = useNameOf();
  const actions = useActions();
  if (!ch) return null;
  const count = unreadOf(ch);
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
        className={`mx-3 flex w-[calc(100%-24px)] items-start gap-3 rounded-[14px] px-3 py-2.5 text-left transition-all duration-150 ${
          active ? "bg-white shadow-[0_1px_3px_rgba(30,43,36,0.10)]" : "hover:bg-white/80"
        }`}
      >
        <Avatar userId={ch.dm_user_id} size={38} showOnline ring="side" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-[14px] ${
                count > 0 ? "font-bold text-sk-text" : active ? "font-bold text-[#2D6A4F]" : "font-bold text-[#3F4E45]"
              }`}
            >
              {self ? `${name}（自分）` : name}
            </span>
            <span className="shrink-0 text-[11px] text-sk-mute">
              {formatDayLabel(at) === "今日" ? formatTime(at) : formatDayLabel(at)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[12px] ${count > 0 ? "text-sk-text" : "text-sk-mute"}`}>{preview}</span>
            <Badge n={count} />
          </span>
        </span>
      </button>
    </li>
  );
});

function DmPanel() {
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
      <div className="px-4 pb-1 pt-2">
        <h2 className="mb-2 px-1 text-[11px] font-bold tracking-[0.08em] text-[#7A877F]">ダイレクトメッセージ</h2>
        <label className="flex h-9 items-center gap-2 rounded-full border border-[#E2E9E4] bg-white px-3 text-sk-mute transition-colors focus-within:border-[#2D6A4F]">
          <Icon name="search" className="w-4 h-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名前で絞り込む"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-sk-text outline-none placeholder:text-[#8A968F]"
          />
        </label>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto py-2 space-y-1 sk-scroll">
        {list.map((c) => (
          <DmRow key={c.id} id={c.id} />
        ))}
        {list.length === 0 && <li className="px-5 py-6 text-center text-[13px] text-sk-mute">ダイレクトメッセージはありません</li>}
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
        className={`mx-3 flex w-[calc(100%-24px)] items-start gap-3 rounded-[14px] px-3 py-2.5 text-left transition-all duration-150 hover:bg-white ${
          unread ? "bg-white/70" : ""
        }`}
      >
        <span className="relative">
          <Avatar userId={m.user_id} size={38} ring="side" />
          <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-[#F6F9F7] bg-[#2D6A4F] text-white">
            <Icon name={item.reason === "reply" ? "thread" : "at"} className="w-2.5 h-2.5" strokeWidth={2.8} />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 text-[11px] text-sk-mute">
            <span className="min-w-0 flex-1 truncate">
              {REASON_LABEL[item.reason]}・#{ch?.name ?? ""}
            </span>
            <span className="shrink-0">{formatDayLabel(m.created_at) === "今日" ? formatTime(m.created_at) : formatDayLabel(m.created_at)}</span>
          </span>
          <span className={`block truncate text-[14px] ${unread ? "font-bold text-sk-text" : "font-bold text-[#3F4E45]"}`}>{author}</span>
          <span className="text-[12px] leading-snug text-sk-mute line-clamp-2">
            {plainText(m.body, nameOf, 140) || (m.attachments.length > 0 ? "📎 ファイル" : "")}
          </span>
        </span>
        {unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#E0782F]" aria-label="未読" />}
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
      <div className="px-4 pb-1 pt-2">
        <h2 className="mb-2 px-1 text-[11px] font-bold tracking-[0.08em] text-[#7A877F]">アクティビティ</h2>
        <div className="flex gap-1.5 overflow-x-auto" role="tablist">
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
              className={`h-7 shrink-0 whitespace-nowrap rounded-full border px-3 text-[12px] font-bold transition-colors ${
                tab === k
                  ? "border-[#2D6A4F] bg-[#2D6A4F] text-white"
                  : "border-[#E2E9E4] bg-white text-sk-mute hover:border-[#C7D8CD] hover:text-sk-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto py-2 space-y-1 sk-scroll">
        {activity.loading && !activity.loaded && (
          <li className="px-5 py-6 text-center text-[13px] text-sk-mute animate-pulse">読み込み中…</li>
        )}
        {items.map((i) => (
          <ActivityRow key={i.message.id} item={i} unread={Date.parse(i.message.created_at) > unreadSince.current} />
        ))}
        {activity.loaded && items.length === 0 && (
          <li className="px-5 py-10 text-center text-[13px] text-sk-mute">
            直近30日のメンションやスレッドへの返信はありません
          </li>
        )}
      </ul>
    </>
  );
}

function CreateChannelButton() {
  const openModal = useOpenModal();
  return (
    <div className="hidden md:block shrink-0 border-t border-[#E2E9E4] p-3">
      <button
        type="button"
        onClick={() => openModal({ type: "create" })}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#2D6A4F] text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(45,106,79,0.25)] transition-all hover:-translate-y-0.5 hover:bg-[#22553F] active:translate-y-0"
      >
        <Icon name="plus" className="w-4 h-4" strokeWidth={2.5} />
        チャンネルを作成
      </button>
    </div>
  );
}

/** 左の一覧パネル。上部の切り替え（ホーム・DM・アクティビティ）で中身が変わる。 */
export default function Sidebar({ className = "" }: { className?: string }) {
  const view = useCS((s) => s.view);
  return (
    <aside className={`flex-col min-h-0 text-sk-text ${className}`}>
      <BrandHeader />
      <SearchField />
      <ViewTabs />
      <div key={view} className="rc-anim-fade-up flex min-h-0 flex-1 flex-col">
        {view === "dms" ? <DmPanel /> : view === "activity" ? <ActivityPanel /> : <HomePanel />}
      </div>
      <CreateChannelButton />
    </aside>
  );
}
