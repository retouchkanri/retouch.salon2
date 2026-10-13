import { requireCapability } from "@/lib/auth";
import type { FollowMark } from "@/lib/followUp";
import { loadFollowUpMarks, loadFollowUps } from "@/lib/followUpData";
import FollowUpBoard from "./FollowUpBoard";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  await requireCapability("payments.manage");
  const [loaded, marks] = await Promise.all([
    loadFollowUps().catch((error: unknown) => ({
      rows: [],
      loginError: null as string | null,
      error: error instanceof Error ? error.message : "要フォローを読み込めませんでした。",
    })),
    // 印が読み込めなくても、一覧は出す（全員が未対応として並ぶ）。
    loadFollowUpMarks()
      .then((list) => ({ list, error: null as string | null }))
      .catch(() => ({ list: [] as FollowMark[], error: "「済」「削除」の印を読み込めませんでした。全員を未対応として表示しています。" })),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">要フォロー</h1>
        <p className="mt-1 text-sm text-ink-soft">退会したあとに気づくのではなく、決済失敗・支払いの更新・長い未ログイン・支援の停止・月額の減少がある会員を、続く可能性があるうちに一覧します。カードの有効期限そのものは保存していないため、期限切れは決済失敗か、支払いの更新が必要な契約として出します。</p>
      </div>
      {"error" in loaded && loaded.error ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{loaded.error}</p> : null}
      {loaded.loginError ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{loaded.loginError}</p> : null}
      {marks.error ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{marks.error}</p> : null}
      <FollowUpBoard rows={loaded.rows} marks={marks.list} />
    </div>
  );
}
