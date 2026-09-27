import { requireMember } from "@/lib/auth";
import BottomRightPanel from "@/components/BottomRightPanel";
import PublicFooterNav from "@/components/PublicFooterNav";

export default async function MyPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMember();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        {children}
      </main>
      {/* 浮遊ボタン: 寄付・チャット・トップ（全デバイスで同じ位置） */}
      <BottomRightPanel />
      <footer className="py-6 text-center text-xs text-ink-mute space-y-3 border-t border-surface-line">
        <PublicFooterNav linkClassName="text-brand hover:underline" />
        <p>© Retouchメンバーズサイト</p>
        {process.env.CONTACT_EMAIL && (
          <p>
            お問い合わせ:{" "}
            <a className="underline" href={`mailto:${process.env.CONTACT_EMAIL}`}>
              {process.env.CONTACT_EMAIL}
            </a>
          </p>
        )}
      </footer>
    </div>
  );
}
