import Link from "next/link";
import { notFound } from "next/navigation";
import LegacyReportView from "@/components/reports/LegacyReportView";
import ReportView from "@/components/reports/ReportView";
import ViewOnly from "@/components/reports/ViewOnly";
import { LEGACY_END_YM, isLegacyMonth, legacyPeriodLabel } from "@/lib/legacyReport";
import { monthLabel, parseYearMonth } from "@/lib/monthlyReport";
import { loadSavedReport } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function MemberReportPage({ params }: { params: { ym: string } }) {
  if (!parseYearMonth(params.ym)) notFound();
  // システム開始前で会員に出すのは、開始前のまとめ（LEGACY_END_YM）だけ。
  const legacy = isLegacyMonth(params.ym);
  if (legacy && params.ym !== LEGACY_END_YM) notFound();
  const { saved } = await loadSavedReport(createSupabaseAdminClient(), params.ym).catch(() => ({ saved: null, tableMissing: false, error: "read failed" }));
  if (!saved?.published_at) notFound();
  if (legacy ? !saved.legacy : !saved.snapshot) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/mypage/reports" className="text-sm text-brand underline">決済報告の一覧</Link>
        <h1 className="mt-1 text-2xl font-bold">{legacy ? `${legacyPeriodLabel()}の収支まとめ` : `${monthLabel(params.ym)}の決済報告`}</h1>
        <p className="mt-1 text-xs text-ink-mute">会員の皆さまにご覧いただくための報告です。印刷・コピー・保存はできません。</p>
      </div>
      {/* 会員は見るだけ。印刷・コピー・保存の操作は ViewOnly で止める。 */}
      <ViewOnly>
        {saved.legacy ? (
          <LegacyReportView summary={saved.legacy.summary} note={saved.legacy.note} />
        ) : saved.snapshot ? (
          <ReportView report={saved.snapshot.report} expenses={saved.snapshot.expenses} note={saved.snapshot.note} />
        ) : null}
      </ViewOnly>
    </div>
  );
}
