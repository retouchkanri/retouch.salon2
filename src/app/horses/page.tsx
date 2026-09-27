import type { Metadata } from "next";
import Link from "next/link";
import HorsesSupportSection from "@/components/HorsesSupportSection";
import PublicFooterNav from "@/components/PublicFooterNav";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "馬ごとの支援状況",
  description:
    "Retouchで支援を受けている引退競走馬の一覧。支援者数・口数・ニックネームを確認できます。",
  alternates: { canonical: "/horses" },
};

export const dynamic = "force-dynamic";

export default async function HorsesPage() {
  // ログイン済みの会員は再登録を経ず会員専用の支援ページへ直接遷移させる。
  const session = await getSession();
  const supportHref = session?.customerId ? "/mypage/supports/new" : "/signup";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-5 pt-8">
          <Link href="/" className="text-brand underline text-sm">
            ← トップページへ
          </Link>
        </div>
        <HorsesSupportSection supportHref={supportHref} />
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
