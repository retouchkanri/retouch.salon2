import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { MEMBER_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import SelfServiceClosedNotice from "@/components/SelfServiceClosedNotice";
import type { SupportSubscription } from "@/types/db";
import StopSupportButton from "./StopSupportButton";

export default async function StopSupportPage({ params }: { params: { id: string } }) {
  const session = await requireMember();
  if (!session.customerId) return notFound();
  if (!MEMBER_SELF_SERVICE_ENABLED) {
    return (
      <SelfServiceClosedNotice
        title="支援の停止について"
        description="支援の停止は、現在運営にて承っております。お手数ですが運営までお問い合わせください。"
      />
    );
  }

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("support_subscriptions")
    .select("*, horse:horses(*), contract:contracts(current_period_end)")
    .eq("id", params.id)
    .eq("customer_id", session.customerId)
    .maybeSingle();

  const s = data as (SupportSubscription & {
    contract?: { current_period_end: string | null } | null;
  }) | null;
  if (!s) return notFound();

  const scheduledEnd = s.contract?.current_period_end ?? null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">支援を停止する</h1>
      <div className="card">
        <p className="text-ink-soft">以下の支援を停止しようとしています。</p>
        <p className="text-lg font-bold mt-2">{s.horse?.name}</p>
        <p className="text-sm">{s.units} 口 / {s.monthly_amount.toLocaleString()} 円 / 月</p>
      </div>
      <div className="card border-2 border-amber-300 bg-amber-50">
        <p className="font-bold text-amber-800">ご確認ください</p>
        <ul className="mt-2 text-sm list-disc list-inside space-y-1 text-ink">
          <li>
            停止すると、次回更新日以降の継続課金は行われません。
            {scheduledEnd && (
              <>
                <br />
                次回更新日：
                <span className="font-bold">{formatDate(scheduledEnd, false)}</span>
              </>
            )}
          </li>
          <li>次回更新日までは引き続き会員特典をご利用いただけます。</li>
          <li>停止後もいつでも新しい支援として再開できます。</li>
          <li>今期分として既にお支払いいただいた金額は返金されません。</li>
        </ul>
      </div>
      <StopSupportButton id={s.id} />
      <Link href="/mypage" className="btn-ghost w-full text-center">
        やっぱり停止しない（戻る）
      </Link>
    </div>
  );
}
