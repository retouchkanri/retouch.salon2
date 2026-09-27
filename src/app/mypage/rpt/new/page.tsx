import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { MEMBER_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import SelfServiceClosedNotice from "@/components/SelfServiceClosedNotice";
import RptWizard from "./RptWizard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewRptPage() {
  const session = await requireMember();
  if (!session.customerId) return <div className="card">会員情報が見つかりません。</div>;
  if (!MEMBER_SELF_SERVICE_ENABLED) {
    return (
      <SelfServiceClosedNotice
        title="リタポ会員のお申し込みについて"
        description="リタポ会員のお申し込みは、現在運営にて承っております。お手数ですが運営までお問い合わせください。"
      />
    );
  }

  const supabase = createSupabaseServerClient();

  // 既加入チェック
  const { data: rptPlan } = await supabase
    .from("membership_plans")
    .select("id")
    .eq("code", "RPT")
    .eq("is_active", true)
    .maybeSingle();

  const { data: existingContract } = rptPlan
    ? await supabase
        .from("contracts")
        .select("id")
        .eq("customer_id", session.customerId)
        .eq("plan_id", (rptPlan as any).id)
        .in("status", ["active", "past_due", "incomplete"])
        .maybeSingle()
    : { data: null };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">リタポ会員に申し込む</h1>
        <Link href="/mypage" className="text-brand underline">戻る</Link>
      </div>

      <div className="card bg-brand-50/40 border-2 border-brand-100">
        <p className="font-bold text-brand-dark">RetouchPony Team（リタポ）とは</p>
        <p className="text-sm mt-1 text-ink-soft">
          月額3,000円でRetouch馬の活動をご支援いただけるプランです。
          メンバーズ・サポーター・ヘルパーズなど、他のすべての会員種別と併用できます。
        </p>
      </div>

      {existingContract ? (
        <div className="card border-2 border-brand">
          <p className="font-bold text-brand">すでにリタポ会員にご加入いただいています。</p>
          <p className="text-sm mt-1 text-ink-soft">マイページからご確認ください。</p>
          <Link href="/mypage" className="btn-secondary inline-flex mt-3">マイページへ戻る</Link>
        </div>
      ) : (
        <RptWizard />
      )}
    </div>
  );
}
