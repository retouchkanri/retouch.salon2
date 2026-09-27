import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import NewsletterToggle from "./NewsletterToggle";

export const dynamic = "force-dynamic";

export default async function NewsletterSettingsPage() {
  const session = await requireMember();
  const supabase = createSupabaseServerClient();

  let optOut = false;
  if (session.customerId) {
    const { data } = await supabase
      .from("customers")
      .select("newsletter_opt_out")
      .eq("id", session.customerId)
      .maybeSingle();
    optOut = Boolean((data as any)?.newsletter_opt_out);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">メルマガ配信設定</h1>
        <Link href="/mypage" className="text-brand underline">マイページへ戻る</Link>
      </div>
      <NewsletterToggle initialOptOut={optOut} />
    </div>
  );
}
