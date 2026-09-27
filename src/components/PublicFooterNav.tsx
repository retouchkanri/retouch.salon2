import Link from "next/link";

type Props = {
  className?: string;
  linkClassName?: string;
};

const links = [
  { href: "/guide", label: "ご入会のご案内" },
  { href: "/support-guide", label: "1口支援制度のご案内" },
  { href: "/supporters", label: "支援者のみなさま" },
  { href: "/#overview", label: "Retouch（リタッチ）とは？" },
  { href: "/donate", label: "単発寄付" },
  { href: "/#contact", label: "お問い合わせ" },
  { href: "/signup", label: "新規会員登録" },
  { href: "/login", label: "ログイン" },
] as const;

export default function PublicFooterNav({ className = "", linkClassName = "hover:underline" }: Props) {
  return (
    <nav
      className={`flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm ${className}`}
      aria-label="サイトメニュー"
    >
      {links.map((item) => (
        <Link key={item.href} href={item.href} className={linkClassName}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
