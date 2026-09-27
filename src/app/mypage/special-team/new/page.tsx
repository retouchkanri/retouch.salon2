import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { loadHorses, loadPlans, loadActiveSpecialTeam } from "@/lib/customer";
import { SPECIAL_TEAM_NEW_SIGNUPS_ENABLED, MEMBER_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import SelfServiceClosedNotice from "@/components/SelfServiceClosedNotice";
import SpecialTeamWizard from "./SpecialTeamWizard";

export default async function NewSpecialTeamPage() {
  const session = await requireMember();
  if (!session.customerId) return <div className="card">会員情報が見つかりません。</div>;
  if (!MEMBER_SELF_SERVICE_ENABLED) {
    return (
      <SelfServiceClosedNotice
        title="特別チーム会員のお申し込みについて"
        description="特別チーム会員のお申し込みは、現在運営にて承っております。お手数ですが運営までお問い合わせください。"
      />
    );
  }

  const [horses, plans, joined] = await Promise.all([
    loadHorses(true),
    loadPlans(),
    loadActiveSpecialTeam(session.customerId),
  ]);

  const plan = plans.find((p) => p.code === "SPECIAL_TEAM");
  const monthly = plan?.monthly_amount ?? 1000;
  // New sign-ups can be closed via feature flag while keeping existing
  // ¥1,000 subscribers untouched. Treat a closed flag like a missing plan.
  const acceptingSignups = SPECIAL_TEAM_NEW_SIGNUPS_ENABLED && Boolean(plan);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">特別チーム会員に申し込む</h1>
        <Link href="/mypage" className="text-brand underline">戻る</Link>
      </div>

      <div className="card bg-brand-50/40 border-2 border-brand-100">
        <p className="font-bold text-brand-dark">特別チーム会員とは</p>
        <p className="text-sm mt-1 text-ink-soft">
          馬ごとに月額{monthly.toLocaleString()}円でご参加いただけるプランです。
          A/B/C会員・支援会員など、他のすべての会員種別と併用できます。
        </p>
      </div>

      {!acceptingSignups && (
        <div className="card border-2 border-warn">
          <p className="text-sm text-warn">現在、特別チーム会員の新規受付を停止しております。</p>
        </div>
      )}

      {acceptingSignups && (
        <SpecialTeamWizard
          horses={horses}
          monthly={monthly}
          joinedHorseIds={joined.map((m) => m.horse_id)}
        />
      )}
    </div>
  );
}
