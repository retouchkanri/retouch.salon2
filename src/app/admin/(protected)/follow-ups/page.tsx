import { requireCapability } from "@/lib/auth";
import { followUpRiskYen } from "@/lib/followUp";
import { loadFollowUps } from "@/lib/followUpData";
import { formatYen } from "@/lib/format";
import FollowUpBoard from "./FollowUpBoard";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  await requireCapability("payments.manage");
  const loaded = await loadFollowUps().catch((error: unknown) => ({
    rows: [],
    loginError: null as string | null,
    error: error instanceof Error ? error.message : "要フォローを読み込めませんでした。",
  }));
  const risk = followUpRiskYen(loaded.rows);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">要フォロー</h1>
        <p className="mt-1 text-sm text-ink-soft">退会したあとに気づくのではなく、決済失敗・支払いの更新・長い未ログイン・支援の停止・月額の減少がある会員を、続く可能性があるうちに一覧します。カードの有効期限そのものは保存していないため、期限切れは決済失敗か、支払いの更新が必要な契約として出します。</p>
      </div>
      {"error" in loaded && loaded.error ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{loaded.error}</p> : null}
      {loaded.loginError ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{loaded.loginError}</p> : null}
      <section className="card">
        <p className="text-sm">対象 {loaded.rows.length}名。いま関係している月額は {formatYen(risk.monthly)} で、このまま途切れると年間 {formatYen(risk.annual)} です。</p>
        <p className="mt-1 text-xs text-ink-mute">たとえば月額3,600円の方が10名そのまま離れると、年間では43万円を超えます。案内文はお一人ずつコピーして送れます。</p>
      </section>
      <FollowUpBoard rows={loaded.rows} />
    </div>
  );
}
