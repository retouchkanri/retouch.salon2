"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InitPayload } from "@/lib/community/types";
import Avatar from "./Avatar";
import ChannelPane from "./ChannelPane";
import { Icon, type IconName } from "./icons";
import Sidebar, { Badge, Menu, MenuItem } from "./Sidebar";
import { CommunityProvider, useActions, useCS, useMe, useName, type View } from "./store";
import ThreadPane from "./ThreadPane";
import { UiProvider, useOpenModal } from "./ui";

// ダイアログは開いたときに読み込む（最初の表示を軽くする）
const ModalHost = dynamic(() => import("./Modals"), { ssr: false });

function Toasts() {
  const toasts = useCS((s) => s.toasts);
  const actions = useActions();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-20 right-3 z-[170] w-[min(360px,calc(100vw-24px))] space-y-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`rounded-[8px] border bg-white px-4 py-3 text-[14px] text-sk-text shadow-[0_4px_12px_rgba(0,0,0,0.15)] ${
            t.kind === "error" ? "border-[#E01E5A66]" : "border-sk-line"
          }`}
        >
          <div className="flex items-start gap-2">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[999px] ${
                t.kind === "error" ? "bg-[#E01E5A] text-white" : t.kind === "info" ? "bg-sk-green text-white" : "bg-sk-side text-white"
              }`}
            >
              <Icon name={t.kind === "error" ? "info" : t.kind === "info" ? "check" : "dm"} className="w-3 h-3" strokeWidth={3} />
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (t.channelId) {
                  actions.openChannel(t.channelId);
                  if (t.parentId) actions.openThread(t.parentId);
                }
                actions.dismissToast(t.id);
              }}
            >
              <p className="font-bold truncate">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sk-mute line-clamp-2">{t.body}</p>}
            </button>
            <button
              type="button"
              onClick={() => actions.dismissToast(t.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-sk-mute hover:bg-sk-soft"
              aria-label="閉じる"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 初回で表示名が未設定なら設定を案内する */
function FirstRunPrompt() {
  const me = useMe();
  const openModal = useOpenModal();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (!me.isStaff && !me.profile?.setup_done) openModal({ type: "profile" });
  }, [me, openModal]);
  return null;
}

// ---------------------------------------------------------------------------
// 上部バー（検索）と左端のナビゲーション
// ---------------------------------------------------------------------------

function TopBar() {
  const openModal = useOpenModal();
  return (
    <div className="hidden md:flex h-10 shrink-0 items-center justify-center bg-sk-frame px-4">
      <button
        type="button"
        onClick={() => openModal({ type: "search", channelId: null })}
        className="flex h-[26px] w-full max-w-[640px] items-center gap-2 rounded-[6px] bg-[#FFFFFF33] px-2 text-left text-[13px] text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:bg-[#FFFFFF40]"
      >
        <Icon name="search" className="w-[15px] h-[15px]" />
        Retouch を検索
      </button>
    </div>
  );
}

function useUnreadTotals() {
  const dm = useCS((s) => s.channels.filter((c) => c.kind === "dm" && c.joined).reduce((n, c) => n + c.unread_count, 0));
  const home = useCS((s) =>
    s.channels.some((c) => c.kind === "channel" && c.joined && c.unread_count > 0 && c.notify !== "none"),
  );
  const activity = useCS((s) => s.activity.unread);
  return { dm, home, activity };
}

function RailButton({
  view,
  icon,
  label,
  badge = 0,
  dot = false,
}: {
  view: View;
  icon: IconName;
  label: string;
  badge?: number;
  dot?: boolean;
}) {
  const current = useCS((s) => s.view);
  const actions = useActions();
  const active = current === view;
  return (
    <button
      type="button"
      onClick={() => actions.setView(view)}
      className="group flex w-full flex-col items-center gap-1 whitespace-nowrap text-[10px] font-bold tracking-tight text-white"
      aria-current={active ? "page" : undefined}
    >
      <span
        className={`relative flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors ${
          active ? "bg-[#FFFFFF33]" : "group-hover:bg-[#FFFFFF1F]"
        }`}
      >
        <Icon name={icon} className="w-5 h-5" />
        {badge > 0 ? (
          <Badge n={badge} className="absolute -right-2 -top-1.5 border-2 border-sk-frame" />
        ) : dot ? (
          <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-[999px] bg-white" />
        ) : null}
      </span>
      <span className={active ? "text-white" : "text-white/80"}>{label}</span>
    </button>
  );
}

function UserMenuButton() {
  const me = useMe();
  const name = useName(me.id);
  const openModal = useOpenModal();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-[8px]" aria-label="あなた" aria-haspopup="menu">
        <Avatar userId={me.id} size={36} showOnline ring="side" />
      </button>
      {open && (
        <Menu onClose={() => setOpen(false)} className="absolute bottom-0 left-12">
          <div className="flex items-center gap-3 px-6 pb-3 pt-1">
            <Avatar userId={me.id} size={36} />
            <div className="min-w-0">
              <p className="font-black truncate">{name}</p>
              <p className="flex items-center gap-1 text-[13px] text-sk-mute">
                <span className="h-2 w-2 rounded-[999px] bg-sk-presence" />
                アクティブ
              </p>
            </div>
          </div>
          <div className="my-1 border-t border-sk-line" />
          <MenuItem
            onClick={() => {
              setOpen(false);
              openModal({ type: "profile" });
            }}
          >
            プロフィールを編集
          </MenuItem>
          {me.isStaff && <MenuItem href="/admin/community">コミュニティ管理</MenuItem>}
          <MenuItem href={me.isStaff ? "/admin" : "/mypage"}>{me.isStaff ? "管理画面に戻る" : "マイページに戻る"}</MenuItem>
        </Menu>
      )}
    </div>
  );
}

function Rail() {
  const u = useUnreadTotals();
  const openModal = useOpenModal();
  return (
    <nav className="hidden md:flex w-[76px] shrink-0 flex-col items-center gap-4 bg-sk-frame pb-4 pt-2" aria-label="ナビゲーション">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-96.png" alt="Retouch" className="h-9 w-9 rounded-[8px] bg-white object-contain p-0.5" />
      <RailButton view="home" icon="home" label="ホーム" dot={u.home} />
      <RailButton view="dms" icon="dm" label="DM" badge={u.dm} />
      <RailButton view="activity" icon="bell" label="アクティビティ" badge={u.activity} />
      <div className="mt-auto flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={() => openModal({ type: "create" })}
          className="flex h-9 w-9 items-center justify-center rounded-[999px] bg-[#FFFFFF33] text-white hover:bg-[#FFFFFF4D]"
          aria-label="チャンネルを作成する"
          title="チャンネルを作成する"
        >
          <Icon name="plus" className="w-5 h-5" />
        </button>
        <UserMenuButton />
      </div>
    </nav>
  );
}

/** スマホ下部のタブ（Slack アプリと同じ） */
function MobileTabs() {
  const view = useCS((s) => s.view);
  const actions = useActions();
  const openModal = useOpenModal();
  const u = useUnreadTotals();
  const me = useMe();
  const tabs: { key: View | "you"; icon: IconName; label: string; badge?: number; dot?: boolean }[] = [
    { key: "home", icon: "home", label: "ホーム", dot: u.home },
    { key: "dms", icon: "dm", label: "DM", badge: u.dm },
    { key: "activity", icon: "bell", label: "アクティビティ", badge: u.activity },
    { key: "you", icon: "users", label: "あなた" },
  ];
  return (
    <nav className="md:hidden flex h-14 shrink-0 border-t border-sk-line bg-white" aria-label="ナビゲーション">
      {tabs.map((t) => {
        const active = t.key === view;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => (t.key === "you" ? openModal({ type: "profile" }) : actions.setView(t.key))}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${
              active ? "text-sk-text" : "text-sk-mute"
            }`}
          >
            <span className="relative">
              {t.key === "you" ? <Avatar userId={me.id} size={22} /> : <Icon name={t.icon} className="w-[22px] h-[22px]" strokeWidth={active ? 2.4 : 2} />}
              {t.badge ? (
                <Badge n={t.badge} className="absolute -right-3 -top-1.5 border-2 border-white" />
              ) : t.dot ? (
                <span className="absolute -right-0.5 top-0 h-2 w-2 rounded-[999px] bg-sk-badge" />
              ) : null}
            </span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

export function CommunityShell() {
  const mobileView = useCS((s) => s.mobileView);
  const threadOpen = useCS((s) => !!s.threadParentId);
  const fatal = useCS((s) => s.fatal);
  const [offset, setOffset] = useState<number | null>(null);

  // サイトのヘッダーの高さを除いた画面いっぱいに表示する
  useLayoutEffect(() => {
    const header = document.querySelector("header.site-header");
    if (!header) return;
    const update = () => setOffset(Math.round(header.getBoundingClientRect().height));
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(header);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      className="sk-app flex w-full flex-col overflow-hidden bg-sk-frame h-[calc(100dvh-69px)] md:h-[calc(100dvh-73px)]"
      style={offset != null ? { height: `calc(100dvh - ${offset}px)` } : undefined}
    >
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Rail />
        {fatal ? (
          <div className="flex flex-1 items-center justify-center bg-white p-6 text-center md:mb-1 md:mr-1 md:rounded-[8px]">
            <div>
              <p className="mb-3 font-bold text-[#E01E5A]">{fatal}</p>
              <button
                type="button"
                className="h-9 rounded-[4px] border border-[#1D1C1D4D] px-4 font-bold"
                onClick={() => window.location.reload()}
              >
                再読み込み
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden md:mb-1 md:mr-1 md:rounded-[8px]">
            <div className={`${mobileView === "list" ? "flex" : "hidden"} md:flex w-full md:w-[260px] shrink-0 flex-col min-h-0`}>
              <Sidebar className="flex flex-1" />
              <MobileTabs />
            </div>
            <main
              className={`${mobileView === "channel" ? "flex" : "hidden"} md:flex min-h-0 min-w-0 flex-1 bg-white ${
                threadOpen ? "lg:border-r lg:border-sk-line" : ""
              }`}
            >
              <ChannelPane />
            </main>
            {threadOpen && <ThreadPane />}
          </div>
        )}
      </div>
      <ModalHost />
      <Toasts />
      <FirstRunPrompt />
    </div>
  );
}

export default function CommunityApp({
  init,
  explicitChannel,
  initialDmUserId,
  initialMessageId,
}: {
  init: InitPayload;
  explicitChannel: boolean;
  initialDmUserId: string | null;
  initialMessageId: string | null;
}) {
  return (
    <CommunityProvider
      init={init}
      explicitChannel={explicitChannel}
      initialDmUserId={initialDmUserId}
      initialMessageId={initialMessageId}
    >
      <UiProvider>
        <CommunityShell />
      </UiProvider>
    </CommunityProvider>
  );
}
