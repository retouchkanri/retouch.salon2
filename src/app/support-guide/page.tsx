import type { Metadata } from "next";
import Link from "next/link";
import SupportGuideContent from "@/components/SupportGuideContent";
import PublicFooterNav from "@/components/PublicFooterNav";

export const metadata: Metadata = {
  title: "Retouch馬 1口支援制度のご案内",
  description:
    "Retouch馬1口支援制度のご案内。月額12,000円／半口6,000円、8口達成でRetouch管理馬として継続飼養。支援特典・注意事項をご確認ください。",
  alternates: { canonical: "/support-guide" },
};

export default function SupportGuidePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1 bg-surface-soft py-10 px-5">
        <div className="max-w-3xl mx-auto mb-6">
          <Link href="/" className="text-brand underline text-sm">
            ← トップページへ
          </Link>
        </div>
        <div className="max-w-3xl mx-auto">
          <SupportGuideContent showSignupCta />
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
