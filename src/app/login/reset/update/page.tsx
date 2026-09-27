import type { Metadata } from "next";
import ResetUpdateForm from "./ResetUpdateForm";

export const metadata: Metadata = {
  title: "新しいパスワードの設定",
  description: "Retouchメンバーズサイトの新しいパスワードを設定します。",
  robots: { index: false, follow: false },
};

// Reads the recovery token from the URL at runtime — never prerender/cache.
export const dynamic = "force-dynamic";

export default function ResetUpdatePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-brand">新しいパスワードの設定</h1>
            <p className="text-ink-soft mt-1 text-sm">Retouchメンバーズサイト</p>
          </div>
          <div className="card">
            <ResetUpdateForm />
          </div>
        </div>
      </main>
    </div>
  );
}
