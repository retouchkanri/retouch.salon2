import Image from "next/image";
import Link from "next/link";

type Props = {
  active?: "home" | "login" | "signup" | "donate";
};

export default function PublicHeader({ active }: Props) {
  return (
    <header className="sticky top-0 z-30 w-full bg-white/90 backdrop-blur border-b border-surface-line">
      <div className="w-full flex items-center justify-between gap-3 py-3 pr-[5vw]">
        <Link
          href="/"
          className="flex items-center gap-3 min-w-0"
          style={{ marginLeft: "5vw" }}
          aria-label="Retouchメンバーズサイト"
        >
          <Image
            src="/logo.png"
            alt="Retouch Members Site"
            width={220}
            height={64}
            priority
            className="h-12 w-auto"
          />
        </Link>
        <nav className="flex items-center gap-2">
          {active !== "signup" && (
            <Link
              href="/guide"
              className="btn-primary !px-4 !py-2 text-sm"
              aria-label="新規会員登録"
            >
              新規会員登録
            </Link>
          )}
          {active !== "login" && (
            <Link
              href="/login"
              className="btn-secondary !px-4 !py-2 text-sm"
              aria-label="ログイン"
            >
              ログイン
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
