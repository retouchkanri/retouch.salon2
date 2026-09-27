import type { Metadata } from "next";
import Link from "next/link";
import AuthPageLayout from "@/components/AuthPageLayout";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import AccountCreateForm from "./AccountCreateForm";

export const metadata: Metadata = {
  title: "アカウント作成",
  description: "Retouchメンバーズサイトのアカウント作成（本登録）ページです。",
  robots: { index: false, follow: false },
};

// 確認トークンに依存するため常に動的レンダリング。
export const dynamic = "force-dynamic";

export default async function AccountCreatePage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = (searchParams.token ?? "").trim();
  let email: string | null = null;
  let invalid = !token;

  if (token) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("registration_tokens")
      .select("email, used_at, expires_at")
      .eq("token", token)
      .maybeSingle();
    const row = data as
      | { email: string; used_at: string | null; expires_at: string }
      | null;
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      invalid = true;
    } else {
      email = row.email;
    }
  }

  return (
    <AuthPageLayout>
      <div className="card">
        {invalid || !email ? (
          <div className="text-center space-y-4 py-4">
            <h1 className="text-xl font-bold text-danger">リンクが無効です</h1>
            <p className="text-sm text-ink-soft leading-relaxed">
              このアカウント作成リンクは無効か、有効期限（24時間）が切れています。
              <br />
              お手数ですが、もう一度メール登録からやり直してください。
            </p>
            <Link href="/signup" className="btn-primary inline-flex">
              新規会員登録へ戻る
            </Link>
          </div>
        ) : (
          <AccountCreateForm token={token} email={email} />
        )}
      </div>
    </AuthPageLayout>
  );
}
