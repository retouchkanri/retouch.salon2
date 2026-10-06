import Link from "next/link";
import { LEGACY_END_YM, legacyPeriodLabel } from "@/lib/legacyReport";
import { monthLabel } from "@/lib/monthlyReport";
import { listPublishedReports } from "@/lib/monthlyReportData";

export const dynamic = "force-dynamic";

export default async function MemberReportsPage() {
  const { rows } = await listPublishedReports().catch(() => ({ rows: [], tableMissing: false }));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">月次の決済報告</h1>
      <p className="text-sm text-ink-soft">公開された月の会員数、支援、寄付と、運営経費・保護管理費の使いみちを確認できます。</p>
      {rows.length === 0 ? (
        <p className="card text-sm text-ink-soft">公開された決済報告はまだありません。</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {rows.map((row) => (
            <li key={row.year_month}>
              <Link href={`/mypage/reports/${row.year_month}`} className="card block hover:shadow-lg transition-shadow">
                {row.year_month === LEGACY_END_YM ? (
                  <>
                    <p className="text-lg font-bold">{legacyPeriodLabel()}</p>
                    <p className="mt-1 text-xs text-ink-soft">会員サイト開始前の収支まとめを見る</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-bold">{monthLabel(row.year_month)}</p>
                    <p className="mt-1 text-xs text-ink-soft">決済報告を見る</p>
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
