import Link from "next/link";
import { monthLabel } from "@/lib/monthlyReport";
import { listPublishedReports } from "@/lib/monthlyReportData";

export const dynamic = "force-dynamic";

export default async function MemberReportsPage() {
  const { rows } = await listPublishedReports().catch(() => ({ rows: [], tableMissing: false }));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">月次の収支報告</h1>
      <p className="text-sm text-ink-soft">公開された月の会員数、支援、寄付と、運営経費・保護管理費の使いみちを確認できます。</p>
      {rows.length === 0 ? (
        <p className="card text-sm text-ink-soft">公開された収支報告はまだありません。</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {rows.map((row) => (
            <li key={row.year_month}>
              <Link href={`/mypage/reports/${row.year_month}`} className="card block hover:shadow-lg transition-shadow">
                <p className="text-lg font-bold">{monthLabel(row.year_month)}</p>
                <p className="mt-1 text-xs text-ink-soft">収支報告を見る / 印刷してPDF保存</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
