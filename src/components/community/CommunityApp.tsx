"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./theme.css";
import type { InitPayload } from "@/lib/community/types";
import Avatar from "./Avatar";
import ChannelPane from "./ChannelPane";
import { Icon, type IconName } from "./icons";
import Sidebar, { Badge, useUnreadTotals } from "./Sidebar";
import { CommunityProvider, useActions, useCS, useMe, type View } from "./store";
import ThreadPane from "./ThreadPane";
import { UiProvider, useOpenModal } from "./ui";

// ダイアログは開いたときに読み込む（最初の表示を軽くする）
const ModalHost = dynamic(() => import("./Modals"), { ssr: false });

function Toasts() {
  const toasts = useCS((s) => s.toasts);
  const actions = useActions();
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-20 right-3 z-[170] w-[min(360px,calc(100vw-24px))] space-y-2 md:bottom-6 md:right-6"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`rc-anim-slide-in overflow-hidden rounded-[16px] border bg-white px-4 py-3 text-[14px] text-sk-text shadow-[0_12px_32px_rgba(30,43,36,0.18)] ${
            t.kind === "error" ? "border-[#D2475E55]" : "border-sk-line"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                t.kind === "error"
                  ? "bg-[#FBE7EA] text-[#D2475E]"
                  : t.kind === "info"
                    ? "bg-[#E3F0E8] text-[#2D6A4F]"
                    : "bg-[#FDEBDD] text-[#E0782F]"
              }`}
            >
              <Icon name={t.kind === "error" ? "info" : t.kind === "info" ? "check" : "dm"} className="w-3.5 h-3.5" strokeWidth={2.5} />
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
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sk-mute transition-colors hover:bg-sk-soft"
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

/** スマホ下部のタブ */
function MobileTabs() {
  const view = useCS((s) => s.view);
  const actions = useActions();
  const openModal = useOpenModal();
  const u = useUnreadTotals();
  const me = useMe();
  const tabs: { key: View | "you"; icon: IconName; label: string; badge?: number; dot?: boolean }[] = [
    { key: "home", icon: "home", label: "ホーム", badge: u.homeCount },
    { key: "dms", icon: "dm", label: "DM", badge: u.dm },
    { key: "activity", icon: "bell", label: "アクティビティ", badge: u.activity },
    { key: "you", icon: "users", label: "あなた" },
  ];
  return (
    <nav className="md:hidden flex h-16 shrink-0 gap-1 border-t border-sk-line bg-white px-2 py-1.5" aria-label="ナビゲーション">
      {tabs.map((t) => {
        const active = t.key === view;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => (t.key === "you" ? openModal({ type: "profile" }) : actions.setView(t.key))}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[12px] text-[11px] font-bold transition-colors ${
              active ? "bg-[#E3F0E8] text-[#2D6A4F]" : "text-sk-mute"
            }`}
          >
            <span className="relative">
              {t.key === "you" ? (
                <Avatar userId={me.id} size={22} showOnline />
              ) : (
                <Icon name={t.icon} className="w-[22px] h-[22px]" strokeWidth={active ? 2.4 : 2} />
              )}
              {t.badge ? (
                <Badge n={t.badge} className="absolute -right-3 -top-1.5 border-2 border-white" />
              ) : t.dot ? (
                <span className="absolute -right-0.5 top-0 h-2 w-2 rounded-full bg-[#E0782F]" />
              ) : null}
            </span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

const PANEL = "md:rounded-[20px] md:border md:border-[#E2E9E4] md:shadow-[0_1px_2px_rgba(30,43,36,0.06),0_8px_24px_rgba(30,43,36,0.06)]";

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
      className="sk-app flex w-full flex-col overflow-hidden h-[calc(100dvh-69px)] md:h-[calc(100dvh-73px)]"
      style={offset != null ? { height: `calc(100dvh - ${offset}px)` } : undefined}
    >
      <div className="flex min-h-0 flex-1 md:gap-3 md:p-3">
        {fatal ? (
          <div className={`flex flex-1 items-center justify-center bg-white p-6 text-center ${PANEL}`}>
            <div>
              <p className="mb-3 font-bold text-[#D2475E]">{fatal}</p>
              <button
                type="button"
                className="h-10 rounded-full bg-[#2D6A4F] px-5 font-bold text-white transition-colors hover:bg-[#22553F]"
                onClick={() => window.location.reload()}
              >
                再読み込み
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`${mobileView === "list" ? "flex" : "hidden"} md:flex rc-anim-fade-up w-full md:w-[288px] shrink-0 flex-col min-h-0 overflow-hidden bg-[#F6F9F7] ${PANEL}`}
            >
              <Sidebar className="flex flex-1" />
              <MobileTabs />
            </div>
            <main
              className={`${mobileView === "channel" ? "flex" : "hidden"} md:flex rc-anim-fade-up min-h-0 min-w-0 flex-1 overflow-hidden bg-white ${PANEL}`}
            >
              <ChannelPane />
            </main>
            {threadOpen && (
              <div className={`rc-anim-slide-in contents md:flex md:min-h-0 md:overflow-hidden md:bg-white ${PANEL}`}>
                <ThreadPane />
              </div>
            )}
          </>
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
