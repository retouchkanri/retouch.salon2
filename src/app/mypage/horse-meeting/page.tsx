import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { loadActiveSupports, loadCustomer } from "@/lib/customer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasActiveSupport } from "@/lib/bookings";
import { formatSupportedHorsesForInput } from "@/lib/horseMeetings";
import { MEMBER_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import type { HorseMeetingRequest } from "@/types/db";
import HorseMeetingForm from "./HorseMeetingForm";

export default async function HorseMeetingPage() {
  const session = await requireMember();
  if (!session.customerId) {
    return <div className="card">会員情報が見つかりません。</div>;
  }

  const admin = createSupabaseAdminClient();
  const [customer, supports, isSupporter, { data: requests }] = await Promise.all([
    loadCustomer(session.customerId),
    loadActiveSupports(session.customerId),
    hasActiveSupport(admin as any, session.customerId),
    admin
      .from("horse_meeting_requests")
      .select("*")
      .eq("customer_id", session.customerId)
      .order("requested_at", { ascending: false }),
  ]);

  if (!isSupporter) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">馬の面会</h1>
          <Link href="/mypage" className="text-brand underline">
            戻る
          </Link>
        </div>
        <div className="card border-2 border-warn">
          <p className="font-bold text-warn">ご利用条件</p>
          <p className="text-sm mt-2">
            馬の面会は、半口以上の支援会員様限定です。まずは支援のお申し込みをお願いいたします。
          </p>
          <Link href="/mypage/supports/new" className="btn-primary inline-flex mt-4">
            支援を申し込む
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">馬の面会</h1>
        <Link href="/mypage" className="text-brand underline">
          戻る
        </Link>
      </div>
      <HorseMeetingForm
        customerName={customer?.full_name ?? "会員"}
        defaultApplicantName={customer?.full_name ?? ""}
        defaultSupportedHorses={formatSupportedHorsesForInput(supports)}
        existing={(requests as HorseMeetingRequest[]) ?? []}
        selfServiceEnabled={MEMBER_SELF_SERVICE_ENABLED}
      />
    </div>
  );
}
