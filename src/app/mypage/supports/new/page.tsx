import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { loadHorses, loadPlans, loadActiveSupports, loadActiveContract } from "@/lib/customer";
import { SUPPORT_UNIT_PRICE, isBasicMemberPlanCode } from "@/lib/constraints";
import { MEMBER_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import SelfServiceClosedNotice from "@/components/SelfServiceClosedNotice";
import NewSupportWizard from "./NewSupportWizard";

export default async function NewSupportPage({
  searchParams,
}: {
  searchParams?: { horse_id?: string };
}) {
  const session = await requireMember();
  if (!session.customerId) return <div className="card">会員情報が見つかりません。</div>;
  if (!MEMBER_SELF_SERVICE_ENABLED) {
    return (
      <SelfServiceClosedNotice
        title="支援のお申し込みについて"
        description="一口支援の新規お申し込みは、現在運営にて承っております。お手数ですが運営までお問い合わせください。"
      />
    );
  }

  const [horses, plans, existingSupports, contract] = await Promise.all([
    loadHorses(true),
    loadPlans(),
    loadActiveSupports(session.customerId),
    loadActiveContract(session.customerId),
  ]);

  const supportPlans = plans.filter((p) => p.code === "SUPPORT");
  // All SUPPORT plans are priced uniformly at SUPPORT_UNIT_PRICE per 口; present a
  // single canonical option (the ¥12,000 "1口" plan) and let 口数 express 半口/複数口.
  const supportPlan =
    supportPlans.find((p) => (p.unit_amount ?? p.monthly_amount) === SUPPORT_UNIT_PRICE) ??
    supportPlans[0] ??
    null;
  const basicPlan = contract?.plan;
  const conflictingContract =
    basicPlan && isBasicMemberPlanCode(basicPlan.code) ? contract : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">新しい支援を追加</h1>
        <Link href="/mypage" className="text-brand underline">戻る</Link>
      </div>

      <div className="card bg-brand-50/40 border border-brand/20">
        <p className="text-sm text-ink-soft leading-relaxed">
          1口支援制度の詳細（支援特典・8口達成・半口支援・注意事項など）は
          <Link href="/support-guide" className="text-brand underline mx-1">
            Retouch馬 1口支援制度のご案内
          </Link>
          を必ずご確認ください。
        </p>
      </div>

      {conflictingContract && (
        <div className="card border-2 border-warn">
          <p className="font-bold text-warn">ご注意</p>
          <p className="text-sm mt-1">
            現在{basicPlan?.name}にご加入中です。メンバーズ会員・サポーター会員・リェリーフ会員とヘルパーズ会員（一口支援・半口支援）は併用できません。
            このまま申し込みを進めると、<strong>現在の{basicPlan?.name}は自動的に解約</strong>されてからヘルパーズ会員（一口支援）へ切り替わります。
          </p>
        </div>
      )}

      <NewSupportWizard
        horses={horses}
        plan={supportPlan}
        existingHorseIds={existingSupports.map((s) => s.horse_id)}
        conflictingContractId={conflictingContract?.id ?? null}
        conflictingPlanName={basicPlan?.name ?? null}
        initialHorseId={searchParams?.horse_id ?? null}
      />
    </div>
  );
}
