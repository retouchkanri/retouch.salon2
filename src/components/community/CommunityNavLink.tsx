"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { UnreadSummary } from "@/lib/community/types";
import { useCommunityNavBadge } from "./useCommunityNavBadge";

/**
 * 「コミュニティ」リンク（未読バッジつき）。
 * - header: サイトヘッダー用
 * - fab: 右下フローティング用（モバイル）
 * ログイン中は常に表示（SiteHeader / BottomRightPanel 側で session を見てマウントする）。
 * 未読は取得できたときだけバッジに反映。購読は useCommunityNavBadge で1本。
 */
export default function CommunityNavLink({
  variant = "header",
}: {
  variant?: "header" | "fab";
} = {}) {
  const pathname = usePathname() ?? "";
  const inCommunity = pathname.startsWith("/community");
  const [popup, setPopup] = useState<string | null>(null);
  const [viewport, setViewport] = useState<"unknown" | "mobile" | "desktop">("unknown");

  const onBump = useCallback((s: UnreadSummary) => {
    if (inCommunity) return;
    const text = s.dm_unread > 0 ? "新しいダイレクトメッセージが届いています" : "コミュニティに新着メッセージがあります";
    setPopup(text);
    setTimeout(() => setPopup((p) => (p === text ? null : p)), 7000);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification("Retouch コミュニティ", { body: text, icon: "/icons/icon-192.png", tag: "community-nav" });
        n.onclick = () => {
          window.focus();
          window.location.href = "/community";
        };
      } catch {
        // ignore
      }
    }
  }, [inCommunity]);

  const summary = useCommunityNavBadge(inCommunity ? undefined : onBump, !inCommunity);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setViewport(mq.matches ? "mobile" : "desktop");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ビューポート確定前は描画しない（ヘッダー/FAB の一瞬の二重表示を防ぐ）
  if (viewport === "unknown") return null;
  // ヘッダーはデスクトップ、FAB はモバイルのみ
  if (variant === "header" && viewport === "mobile") return null;
  if (variant === "fab" && viewport === "desktop") return null;

  const badge = inCommunity ? 0 : summary?.badge ?? 0;
  const dot = !inCommunity && !badge && !!summary?.has_unread;
  const label = badge > 0 ? `コミュニティ（未読 ${badge} 件）` : "コミュニティ";
  const attn = !inCommunity ? "community-nav-attn" : "";

  const badgeEl = (
    <>
      {badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums leading-none">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {dot && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-rose-500" aria-hidden />}
    </>
  );

  const link =
    variant === "fab" ? (
      <Link
        href="/community"
        className={`relative w-12 h-12 rounded-full bg-white shadow-lg border border-surface-line flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-200 ${attn}`}
        aria-label={label}
        title="コミュニティ"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/comunity.png" alt="" width={36} height={26} className="h-[26px] w-auto object-contain" aria-hidden />
        {badgeEl}
      </Link>
    ) : (
      <Link
        href="/community"
        className={`relative inline-flex items-center justify-center rounded-full p-1.5 text-sm font-semibold transition ${
          inCommunity ? "bg-brand-50 text-brand" : `text-ink-soft hover:text-brand hover:bg-surface-soft ${attn}`
        }`}
        aria-label={label}
        title="コミュニティ"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/comunity.png" alt="" width={36} height={26} className="h-[26px] w-auto object-contain" aria-hidden />
        {badgeEl}
      </Link>
    );

  return (
    <>
      {link}
      {popup && !inCommunity && (
        <Link
          href="/community"
          onClick={() => setPopup(null)}
          className={`fixed z-[130] max-w-[calc(100vw-24px)] rounded-lg border border-surface-line bg-white shadow-xl px-4 py-3 text-sm font-semibold text-ink hover:bg-surface-soft ${
            variant === "fab" ? "bottom-[14.5rem] right-2" : "top-20 right-3"
          }`}
          role="status"
        >
          <span className="inline-flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/comunity.png" alt="" width={20} height={14} className="h-3.5 w-auto object-contain" />
            {popup}
          </span>
        </Link>
      )}
    </>
  );
}
