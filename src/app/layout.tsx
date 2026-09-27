import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://retouch-members.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Retouchメンバーズサイト｜引退競走馬支援プラットフォーム",
    template: "%s | Retouch メンバーズサイト",
  },
  description:
    "引退競走馬の安定した余生を支える会員制プラットフォーム。月次サポート・単発寄付・馬の近況確認がスマホひとつで完結します。",
  keywords: ["引退競走馬", "競走馬支援", "Retouch", "引退馬", "寄付", "ホースレスト", "馬の福祉"],
  authors: [{ name: "Retouch", url: siteUrl }],
  robots: { index: true, follow: true },
  alternates: { canonical: siteUrl },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Retouchメンバーズサイト",
    title: "Retouchメンバーズサイト｜引退競走馬支援プラットフォーム",
    description:
      "引退競走馬の安定した余生を支える会員制プラットフォーム。月次サポート・単発寄付・馬の近況確認がスマホひとつで完結します。",
    locale: "ja_JP",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Retouch ロゴ" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Retouchメンバーズサイト｜引退競走馬支援プラットフォーム",
    description:
      "引退競走馬の安定した余生を支える会員制プラットフォーム。月次サポート・単発寄付・馬の近況確認がスマホひとつで完結します。",
    images: ["/icons/icon-512.png"],
  },
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    apple: [
      { url: "/icons/icon-152.png", sizes: "152x152" },
      { url: "/icons/icon-192.png", sizes: "192x192" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Retouch",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#2d6a4f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="flex min-h-dvh flex-col overflow-x-clip bg-surface-soft text-ink antialiased font-sans">
        <SiteHeader />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
