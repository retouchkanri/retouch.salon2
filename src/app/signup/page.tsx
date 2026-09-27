import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthPageLayout from "@/components/AuthPageLayout";
import { getSession } from "@/lib/auth";
import SignupForm from "./SignupForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "新規会員登録",
  description: "Retouchメンバーズサイトの新規会員登録ページです。",
  robots: { index: false, follow: false },
};

export default async function SignupPage() {
  const session = await getSession();
  if (session) redirect("/mypage");

  return (
    <AuthPageLayout>
      <div className="card">
        <SignupForm />
      </div>
    </AuthPageLayout>
  );
}
