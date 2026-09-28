import Image from "next/image";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { resolveAvatarUrl } from "@/lib/avatars";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveBadge, type Badge } from "@/lib/roles";
import { loadPaymentStat } from "@/lib/badge";
import HeaderUserMenu from "./HeaderUserMenu";
import MobileCtaBar from "./MobileCtaBar";
import CommunityNavLink from "./community/CommunityNavLink";
import { canSeeCommunity } from "@/lib/community/visibility";

export default async function SiteHeader() {
  const session = await getSession();

  let name = "";
  let avatarUrl: string | null = null;
  let badge: Badge = { kind: "none" };
  if (session) {
    try {
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from("customers")
        .select("full_name, avatar_url, joined_at, created_at")
        .eq("auth_user_id", session.userId)
        .maybeSingle();
      name = (data?.full_name as string) ?? "";
      avatarUrl = resolveAvatarUrl(session.role, (data?.avatar_url as string | null) ?? null);
      const stat = await loadPaymentStat(admin, session.customerId);
      badge = resolveBadge(session.role, {
        registeredAt: (data?.joined_at as string | null) ?? (data?.created_at as string | null) ?? null,
        firstPaymentAt: stat.firstPaymentAt,
        totalPaidYen: stat.totalPaidYen,
        hasActiveRpt: session.hasActiveRpt,
      });
    } catch {
      // Supabase unreachable
    }
  }

  return (
    <>
      <header className="site-header sticky top-0 z-[100] w-full shrink-0 border-b border-surface-line overflow-visible">
        {/*
          iOS Safari has a known WebKit bug where `backdrop-filter` applied
          directly to a `position: sticky` element can break touch
          hit-testing for its interactive descendants — taps land but never
          reach the button/link underneath (reported 2026-08: tapping the
          header user menu on iPhone did nothing). Moving the blur onto its
          own background layer, kept behind the real (unfiltered) content via
          DOM order, keeps the same frosted-glass look without breaking taps.
        */}
        <div aria-hidden className="absolute inset-0 bg-white/95 backdrop-blur" />
        <div className="relative w-full max-w-[100vw] flex items-center justify-between gap-3 py-3 px-[5vw] overflow-x-clip overflow-y-visible">
          <Link
            href="/"
            className="flex items-center min-w-0 gap-3 shrink transition-transform duration-200 hover:scale-105"
            aria-label="Retouchメンバーズサイト"
          >
            <Image
              src="/logo.png"
              alt="Retouch Members Site"
              width={220}
              height={64}
              priority
              sizes="220px"
              className="h-9 w-auto md:h-12"
            />
          </Link>

          <div className="flex items-center gap-4 md:gap-6 min-w-0">
          {/* コミュニティへの導線（会員に非公開の間は運営のみ。src/lib/community/visibility.ts） */}
          {session && canSeeCommunity(session.role) && <CommunityNavLink />}

          {/* Desktop: phone + nav */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href="tel:050-6875-3336"
              className="flex items-center gap-2 text-[1.3125rem] leading-none text-ink-soft hover:text-brand transition"
              aria-label="電話でお問い合わせ: 050-6875-3336"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://api.iconify.design/fluent-emoji-flat/telephone-receiver.svg?height=28"
                alt=""
                width={28}
                height={28}
                className="w-7 h-7 shrink-0"
                aria-hidden
              />
              <span className="font-semibold">050-6875-3336</span>
            </a>
            {session ? (
              <HeaderUserMenu
                name={name}
                email={session.email ?? ""}
                role={session.role}
                badge={badge}
                avatarUrl={avatarUrl}
              />
            ) : (
              <nav className="flex items-center gap-2">
                <Link href="/signup" className="btn-primary !px-4 !py-2 text-sm btn-pulse">
                  新規会員登録
                </Link>
                <Link href="/login" className="btn-secondary !px-4 !py-2 text-sm">
                  ログイン
                </Link>
              </nav>
            )}
          </div>

          {/* Mobile: phone icon only (+ user menu when logged in) */}
          <div className="md:hidden flex items-center gap-3">
            <a
              href="tel:050-6875-3336"
              className="flex items-center text-ink-soft hover:text-brand transition"
              aria-label="電話でお問い合わせ: 050-6875-3336"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://api.iconify.design/fluent-emoji-flat/telephone-receiver.svg?height=24"
                alt=""
                width={24}
                height={24}
                className="w-6 h-6 shrink-0"
                aria-hidden
              />
            </a>
            {session && (
              <HeaderUserMenu
                name={name}
                email={session.email ?? ""}
                role={session.role}
                badge={badge}
                avatarUrl={avatarUrl}
              />
            )}
          </div>
          </div>
        </div>
      </header>

      {/* Mobile sticky bottom CTA bar — hidden on login/signup */}
      {!session && <MobileCtaBar />}
    </>
  );
}
