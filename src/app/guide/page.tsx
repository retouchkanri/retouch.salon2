import type { Metadata } from "next";
import Link from "next/link";
import MembershipGuideContent from "@/components/MembershipGuideContent";
import PublicFooterNav from "@/components/PublicFooterNav";

export const metadata: Metadata = {
  title: "ご入会のご案内",
  description:
    "Retouch（リタッチ）の会員制度・会員特典・会費の使い道について。メンバーズ・サポーター・リェリーフ会員・RetouchPony（リタポ）メンバー・1口支援馬会員制度のご案内。",
  alternates: { canonical: "/guide" },
};

export default function MembershipGuidePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1 bg-surface-soft py-10 px-5">
        <div className="max-w-3xl mx-auto mb-6">
          <Link href="/" className="text-brand underline text-sm">
            ← トップページへ
          </Link>
        </div>
        <div className="max-w-3xl mx-auto">
          <MembershipGuideContent showSignupCta />
        </div>
      </main>

      <footer className="bg-ink py-8 px-5">
        <div className="max-w-3xl mx-auto space-y-4">
          <PublicFooterNav className="text-white/75" linkClassName="hover:text-white underline-offset-2" />
          <p className="text-white/40 text-xs text-center">© 2026 引退競走馬支援プロジェクト</p>
        </div>
      </footer>
    </div>
  );
}
