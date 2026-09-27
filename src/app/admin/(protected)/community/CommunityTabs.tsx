"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/community", label: "概要・チャンネル" },
  { href: "/admin/community/users", label: "ユーザー" },
  { href: "/admin/community/reports", label: "通報" },
  { href: "/admin/community/broadcast", label: "一括送信" },
];

export default function CommunityTabs({ openReports = 0 }: { openReports?: number }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-surface-line pb-2">
      {TABS.map((t) => {
        const active = t.href === "/admin/community" ? pathname === t.href || pathname.startsWith("/admin/community/channels") : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-1.5 rounded text-sm font-semibold ${active ? "bg-brand text-white" : "text-ink-soft hover:bg-white"}`}
          >
            {t.label}
            {t.href.endsWith("/reports") && openReports > 0 && (
              <span className="ml-1.5 inline-flex min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] items-center justify-center">
                {openReports}
              </span>
            )}
          </Link>
        );
      })}
      <Link href="/community" target="_blank" rel="noopener" className="ml-auto px-3 py-1.5 rounded text-sm font-semibold text-brand underline">
        コミュニティを開く ↗
      </Link>
    </div>
  );
}
