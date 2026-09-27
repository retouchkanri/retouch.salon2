"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ROLE_LABELS_JP, isStaffRole, type Badge, type Role } from "@/lib/roles";
import RoleBadge from "./RoleBadge";

type Props = {
  name: string;
  email: string;
  role: Role;
  badge: Badge;
  avatarUrl: string | null;
};

export default function HeaderUserMenu({ name, email, role, badge, avatarUrl }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isAdmin = isStaffRole(role);
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="relative z-[110]" ref={rootRef}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-brand/30"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="w-9 h-9 rounded-full object-cover border border-surface-line"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center font-bold">
            {initial}
          </div>
        )}
        <span className="font-semibold text-ink max-w-[180px] truncate">{name || email}</span>
        <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden className="text-ink-mute">
          <path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 rounded-xl border border-surface-line bg-white shadow-xl py-2 z-[120]"
        >
          <div className="px-4 py-2 border-b border-surface-line">
            <p className="font-semibold text-ink truncate">{name || "—"}</p>
            <p className="text-xs text-ink-mute truncate">{email}</p>
            <p className="text-xs mt-1 flex items-center gap-1.5">
              <span className="chip-mute">{ROLE_LABELS_JP[role]}</span>
              <RoleBadge badge={badge} />
            </p>
          </div>
          <Link
            href={isAdmin ? "/admin" : "/mypage"}
            className="block px-4 py-2 text-sm hover:bg-surface-soft"
            onClick={() => setOpen(false)}
          >
            マイページ
          </Link>
          <Link
            href="/mypage/profile"
            className="block px-4 py-2 text-sm hover:bg-surface-soft"
            onClick={() => setOpen(false)}
          >
            登録情報の変更
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="block px-4 py-2 text-sm hover:bg-surface-soft"
              onClick={() => setOpen(false)}
            >
              管理画面
            </Link>
          )}
          <div className="border-t border-surface-line mt-1 pt-1">
            <form action="/api/auth/logout?next=/" method="post">
              <button
                type="submit"
                className="w-full text-left px-4 py-2 text-sm text-danger hover:bg-surface-soft"
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
