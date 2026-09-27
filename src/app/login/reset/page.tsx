import type { Metadata } from "next";
import Link from "next/link";
import ResetRequestForm from "./ResetRequestForm";

export const metadata: Metadata = {
  title: "パスワード再設定",
  description: "Retouchメンバーズサイトのパスワードを再設定します。",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-brand">パスワード再設定</h1>
            <p className="text-ink-soft mt-1 text-sm">Retouchメンバーズサイト</p>
          </div>
          <div className="card">
            <ResetRequestForm />
          </div>
          <div className="mt-4 text-center text-sm">
            <Link href="/login" className="text-brand underline">
              ログインへ戻る
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
