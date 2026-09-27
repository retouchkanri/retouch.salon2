"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const HIDE_ON = ["/login", "/signup"];

export default function MobileCtaBar() {
  const pathname = usePathname();
  const hidden = HIDE_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (hidden) return null;

  return (
    <div className="mobile-cta-bar">
      <div className="mobile-cta-bar__actions">
        <Link href="/login" className="mobile-cta-btn mobile-cta-btn--secondary">
          ログイン
        </Link>
        <Link href="/guide" className="mobile-cta-btn mobile-cta-btn--primary btn-pulse">
          無料会員登録
        </Link>
      </div>
    </div>
  );
}
