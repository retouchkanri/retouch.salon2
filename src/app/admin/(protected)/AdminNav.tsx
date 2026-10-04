"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type FocusEvent, type MouseEvent } from "react";
import { type Role, can } from "@/lib/roles";
import { NavIcon } from "./AdminNavIcons";
import { emojiSrc, navGroups } from "./navItems";
import {
  NAV_CLOSED_COOKIE,
  NAV_CLOSED_SEPARATOR,
  NAV_RAIL_COOKIE,
  type NavPrefs,
} from "./navPrefs";

/** Menu emoji (Fluent 3D image). Decorative: the row's label carries the meaning. */
function NavEmoji({ emoji, className = "" }: { emoji: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={emojiSrc(emoji)}
      alt=""
      width={20}
      height={20}
      draggable={false}
      className={`h-5 w-5 select-none ${className}`}
    />
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

function saveCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/admin; max-age=31536000; samesite=lax`;
}

/** The rail only exists at md+; below that the sidebar is a fold-out list. */
function isDesktop(): boolean {
  return window.matchMedia("(min-width: 768px)").matches;
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-light";

export default function AdminNav({
  role,
  initialPrefs,
}: {
  role: Role;
  initialPrefs: NavPrefs;
}) {
  const pathname = usePathname();

  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.cap || can(role, n.cap)) }))
    .filter((g) => g.items.length > 0);
  const currentGroup = groups.find((g) => g.items.some((n) => !n.external && isActive(pathname, n.href)));
  const current = currentGroup?.items.find((n) => !n.external && isActive(pathname, n.href));

  const [rail, setRail] = useState(initialPrefs.rail);
  const [closed, setClosed] = useState<Set<string>>(() => {
    const s = new Set(initialPrefs.closed);
    if (currentGroup) s.delete(currentGroup.id);
    return s;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);

  // On navigation: fold the mobile menu away, and unfold the group holding
  // the new page so its highlighted row is visible.
  const currentGroupId = currentGroup?.id;
  useEffect(() => {
    setMobileOpen(false);
    setTip(null);
    if (!currentGroupId) return;
    setClosed((prev) => {
      if (!prev.has(currentGroupId)) return prev;
      const next = new Set(prev);
      next.delete(currentGroupId);
      return next;
    });
  }, [pathname, currentGroupId]);

  useEffect(() => saveCookie(NAV_RAIL_COOKIE, rail ? "1" : "0"), [rail]);
  useEffect(() => saveCookie(NAV_CLOSED_COOKIE, Array.from(closed).join(NAV_CLOSED_SEPARATOR)), [closed]);

  const allOpen = groups.every((g) => !closed.has(g.id));

  function toggleGroup(id: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setClosed(allOpen ? new Set(groups.map((g) => g.id)) : new Set());
  }

  function toggleRail() {
    setTip(null);
    setRail((v) => !v);
  }

  // Rail mode hides the labels, so hovering / focusing an icon shows it in a
  // floating tooltip. `fixed` escapes the scroll container's clipping.
  function showTip(label: string) {
    return (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
      if (!rail || !isDesktop()) return;
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ label, top: r.top + r.height / 2 });
    };
  }
  const hideTip = () => setTip(null);

  // Classes that only apply while the desktop rail is on.
  const railOnly = (cls: string) => (rail ? cls : "");

  return (
    <aside
      data-rail={rail ? "true" : "false"}
      className={`peer bg-brand-dark bg-gradient-to-b from-[#1f4d3a] via-brand-dark to-[#133324] text-white md:fixed md:top-[73px] md:bottom-0 md:left-0 md:z-40 md:flex md:flex-col md:overflow-hidden md:shadow-[inset_-1px_0_0_rgba(255,255,255,0.06)] md:transition-[width] md:duration-200 md:ease-out ${
        rail ? "md:w-[68px]" : "md:w-[240px]"
      }`}
    >
      {/* Mobile: current page + menu toggle */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 md:hidden">
        {current ? (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/[0.13]">
            <NavEmoji emoji={current.emoji} className={current.fresh ? "nav-fresh-emoji" : ""} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{current?.label ?? "管理メニュー"}</span>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls="admin-nav-list"
          className={`flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/90 transition-colors hover:bg-white/10 ${focusRing}`}
        >
          <NavIcon name={mobileOpen ? "close" : "menu"} className="h-4 w-4" />
          {mobileOpen ? "閉じる" : "メニュー"}
        </button>
      </div>

      {/* Desktop toolbar */}
      <div
        className={`hidden h-12 shrink-0 items-center gap-1 border-b border-white/10 px-3 md:flex ${railOnly("md:justify-center")}`}
      >
        {!rail && (
          <>
            <p className="flex-1 pl-2 text-[10px] font-semibold tracking-[0.25em] text-white/45">MENU</p>
            <button
              type="button"
              onClick={toggleAll}
              title={allOpen ? "すべて折りたたむ" : "すべて展開"}
              aria-label={allOpen ? "すべてのグループを折りたたむ" : "すべてのグループを展開"}
              className={`grid h-7 w-7 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white ${focusRing}`}
            >
              <NavIcon name={allOpen ? "foldAll" : "unfoldAll"} className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={toggleRail}
          onMouseEnter={showTip("メニューを広げる")}
          onMouseLeave={hideTip}
          onFocus={showTip("メニューを広げる")}
          onBlur={hideTip}
          title={rail ? undefined : "アイコン表示に切り替え"}
          aria-label={rail ? "メニューを広げる" : "アイコン表示に切り替え"}
          aria-expanded={!rail}
          aria-controls="admin-nav-list"
          className={`grid h-7 w-7 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white ${focusRing}`}
        >
          <NavIcon name={rail ? "panelOpen" : "panelClose"} className="h-4 w-4" />
        </button>
      </div>

      <nav
        id="admin-nav-list"
        aria-label="管理メニュー"
        onScroll={hideTip}
        className={`${
          mobileOpen ? "block" : "hidden"
        } border-t border-white/10 px-3 pb-3 md:block md:min-h-0 md:flex-1 md:overflow-y-auto md:overflow-x-hidden md:border-t-0 md:pt-1 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]`}
      >
        {groups.map((g, i) => {
          const open = !closed.has(g.id);
          const hasCurrent = g.id === currentGroupId;
          return (
            <section key={g.id} aria-label={g.label}>
              {/* Rail: a thin divider stands in for the group heading. */}
              {i > 0 ? <div aria-hidden="true" className={`mx-2 my-2 hidden h-px bg-white/10 ${railOnly("md:block")}`} /> : null}
              <button
                type="button"
                onClick={() => toggleGroup(g.id)}
                aria-expanded={open}
                aria-controls={`admin-nav-${g.id}`}
                className={`mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold tracking-wider transition-colors hover:bg-white/5 hover:text-white ${
                  hasCurrent ? "text-brand-light" : "text-white/50"
                } ${railOnly("md:hidden")} ${focusRing}`}
              >
                <span className="flex-1 truncate text-left">{g.label}</span>
                {!open ? (
                  <span className="rounded-md bg-white/10 px-1.5 text-[10px] font-normal leading-4 text-white/70">
                    {g.items.length}
                  </span>
                ) : null}
                <NavIcon
                  name="chevronDown"
                  className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
                />
              </button>

              {/* grid-rows 0fr↔1fr animates the fold; `invisible` keeps folded links out of the tab order. */}
              <div
                id={`admin-nav-${g.id}`}
                className={`grid transition-[grid-template-rows,visibility] duration-200 ease-out ${
                  open ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"
                } ${railOnly("md:visible md:grid-rows-[1fr]")}`}
              >
                <ul className="min-h-0 space-y-0.5 overflow-hidden py-0.5">
                  {g.items.map((n) => {
                    const active = !n.external && isActive(pathname, n.href);
                    return (
                      <li key={n.href}>
                        <Link
                          href={n.href}
                          target={n.external ? "_blank" : undefined}
                          rel={n.external ? "noopener noreferrer" : undefined}
                          aria-current={active ? "page" : undefined}
                          onMouseEnter={showTip(n.label)}
                          onMouseLeave={hideTip}
                          onFocus={showTip(n.label)}
                          onBlur={hideTip}
                          className={`group relative flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-[5px] text-sm transition-colors ${focusRing} ${
                            active
                              ? "bg-white font-bold text-brand-dark shadow-sm before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-brand"
                              : "text-white/85 hover:bg-white/[0.07] hover:text-white"
                          }`}
                        >
                          {/* Emoji "pops" on hover, like a chat-app reaction. */}
                          <span
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors ${
                              active ? "bg-brand shadow-sm" :"bg-white/[0.13] group-hover:bg-white/[0.2]"
                            }`}
                          >
                            <NavEmoji
                              emoji={n.emoji}
                              className={n.fresh ? "nav-fresh-emoji" : "transition-transform duration-150 ease-out group-hover:scale-[1.18] motion-reduce:transition-none motion-reduce:group-hover:scale-100"}
                            />
                          </span>
                          <span className={`min-w-0 flex-1 truncate ${railOnly("md:sr-only")}`}>{n.label}</span>
                          {n.fresh ? <span className={`rounded-full bg-amber-300 px-1.5 text-[10px] font-bold leading-4 text-brand-dark ${railOnly("md:hidden")}`}>新</span> : null}
                          {n.external ? (
                            <>
                              <NavIcon
                                name="external"
                                className={`h-3.5 w-3.5 shrink-0 text-white/40 group-hover:text-white/70 ${railOnly("md:hidden")}`}
                              />
                              <span className="sr-only">（新しいタブで開く）</span>
                            </>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
      </nav>

      {tip ? (
        <div
          aria-hidden="true"
          style={{ top: tip.top }}
          className="pointer-events-none fixed left-[76px] z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-lg md:block"
        >
          <span className="absolute -left-1 top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-ink" />
          {tip.label}
        </div>
      ) : null}
    </aside>
  );
}
