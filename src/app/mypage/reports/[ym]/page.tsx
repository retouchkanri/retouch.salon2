import Link from "next/link";
import { notFound } from "next/navigation";
import ReportView from "@/components/reports/ReportView";
import { monthLabel, parseYearMonth } from "@/lib/monthlyReport";
import { loadSavedReport } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function MemberReportPage({ params }: { params: { ym: string } }) {
  if (!parseYearMonth(params.ym)) notFound();
  const { saved } = await loadSavedReport(createSupabaseAdminClient(), params.ym).catch(() => ({ saved: null, tableMissing: false, error: "read failed" }));
  if (!saved?.published_at || !saved.snapshot) notFound();

  return (
    <div className="space-y-4">
      <style>{`@media print { body * { visibility: hidden; } .report-sheet, .report-sheet * { visibility: visible; } .report-sheet { position: absolute; left: 0; top: 0; width: 100%; background: white; } }`}</style>
      <div className="no-print flex items-center justify-between gap-3">
        <div>
          <Link href="/mypage/reports" className="text-sm text-brand underline">収支報告の一覧</Link>
          <h1 className="mt-1 text-2xl font-bold">{monthLabel(params.ym)}の収支報告</h1>
        </div>
        <PrintButton />
      </div>
      <ReportView report={saved.snapshot.report} expenses={saved.snapshot.expenses} note={saved.snapshot.note} />
    </div>
  );
}
