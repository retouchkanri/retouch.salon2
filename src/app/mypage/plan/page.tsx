import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { loadActiveContract, loadActiveSupports, loadPlans } from "@/lib/customer";
import { formatYen } from "@/lib/format";
import { SPECIAL_TEAM_NEW_SIGNUPS_ENABLED, MEMBER_PLAN_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import SelfServiceClosedNotice from "@/components/SelfServiceClosedNotice";
import PlanSelector from "./PlanSelector";

export default async function PlanPage() {
  const session = await requireMember();
  if (!session.customerId) {
    return <div className="card">会員情報が見つかりません。</div>;
  }
  if (!MEMBER_PLAN_SELF_SERVICE_ENABLED) {
    return (
      <SelfServiceClosedNotice
        title="会員種別の変更について"
        description="会員種別（プラン）の変更は、現在運営にて承っております。お手数ですが運営までお問い合わせください。"
      />
    );
  }
  const [plans, contract, supports] = await Promise.all([
    loadPlans(),
    loadActiveContract(session.customerId),
    loadActiveSupports(session.customerId),
  ]);

  // 会員がセルフで選べるのは有料の基本会員(A/B/C)のみ。
  // ¥0 の枠（アテンダー会員・オーナーズ会員等）は管理画面からの手動付与専用。
  const basicPlans = plans.filter((p) => ["A", "B", "C"].includes(p.code) && p.monthly_amount > 0);
  const hasSupport = supports.length > 0;
  const currentBasic = contract?.plan && ["A", "B", "C"].includes(contract.plan.code) ? contract.plan : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">会員種別の選択・変更</h1>
        <Link href="/mypage" className="text-brand underline">戻る</Link>
      </div>

      <div className="card bg-brand-50/40 border border-brand/20">
        <p className="text-sm text-ink-soft leading-relaxed">
          会員制度の詳細（特典・会費の使い道・免責事項など）は
          <Link href="/guide" className="text-brand underline mx-1">
            ご入会のご案内
          </Link>
          をご覧ください。
        </p>
      </div>

      <section className="card">
        <p className="label">現在の会員種別</p>
        <p className="text-2xl font-bold">
          {currentBasic
            ? currentBasic.name
            : hasSupport
            ? "ヘルパーズ会員"
            : "未加入"}
        </p>
        {currentBasic && (
          <p className="text-sm text-ink-soft mt-1">月額 {formatYen(currentBasic.monthly_amount)}（{currentBasic.name}）</p>
        )}
      </section>

      {hasSupport && (
        <div className="card border-2 border-amber-400 bg-amber-50">
          <p className="font-bold text-warn">ご注意：ヘルパーズ会員と併用はできません</p>
          <p className="text-sm mt-1">
            現在、{supports.length}頭の馬をご支援中です。会員種別（アテンダー／メンバーズ／サポーター／リェリーフ会員）へ切り替える場合は、先にすべての支援を停止してください。
          </p>
        </div>
      )}

      <section className="card space-y-3">
        <h2 className="section-title mb-0">プランを選ぶ</h2>
        <p className="text-sm text-ink-soft">
          会員種別（アテンダー／メンバーズ／サポーター／リェリーフ会員）は1つだけお選びいただけます。いつでも変更・停止が可能です。
        </p>
        <PlanSelector
          plans={basicPlans.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            monthly_amount: p.monthly_amount,
            description: p.description,
          }))}
          currentPlanId={currentBasic?.id ?? null}
          disabled={hasSupport}
        />
      </section>

      {currentBasic && !hasSupport && (
        <section className="card">
          <p className="font-bold">プランを停止する</p>
          <p className="text-sm text-ink-soft mb-2">
            現在のプランを停止すると、次回以降の決済が止まります。
          </p>
          <PlanSelector.Cancel />
        </section>
      )}

      {SPECIAL_TEAM_NEW_SIGNUPS_ENABLED && (
        <section className="card bg-brand-50/40 border-2 border-brand-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-brand-dark">特別チーム会員</p>
              <p className="text-sm text-ink-soft mt-1">
                馬ごとに月額1,000円。他の会員種別（サポーター／メンバーズ／リェリーフ会員・ヘルパーズ会員）と併用できます。
              </p>
            </div>
            <Link href="/mypage/special-team/new" className="btn-secondary shrink-0">
              申し込む
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
