import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { currentYearMonth, emptyExpenses, formatYearMonth, monthLabel, parseYearMonth, shiftMonth } from "@/lib/monthlyReport";
import { loadReportBundle } from "@/lib/monthlyReportData";
import ReportView from "@/components/reports/ReportView";
import ReportEditor from "./ReportEditor";

export const dynamic = "force-dynamic";

function monthChoices(current: string): string[] {
  const parsed = parseYearMonth(current)!;
  return Array.from({ length: 18 }, (_, index) => {
    const point = shiftMonth(parsed.year, parsed.month, -index);
    return formatYearMonth(point.year, point.month);
  });
}

export default async function AdminReportsPage({ searchParams }: { searchParams: { ym?: string } }) {
  await requireCapability("payments.manage");
  const current = currentYearMonth();
  const requested = parseYearMonth(searchParams.ym ?? "") ? searchParams.ym! : current;
  const ym = requested > current ? current : requested;
  const bundle = await loadReportBundle(ym).catch((error: unknown) => ({
    report: null,
    saved: null,
    tableMissing: false,
    loadError: error instanceof Error ? error.message : "集計を読み込めませんでした。",
  }));

  return (
    <div className="space-y-4">
      <style>{`@media print { body * { visibility: hidden; } .report-sheet, .report-sheet * { visibility: visible; } .report-sheet { position: absolute; left: 0; top: 0; width: 100%; background: white; } }`}</style>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">経営管理</h1>
          <p className="mt-1 text-sm text-ink-soft">会員、支援、寄付、馬ごとの増減と、月次の収支報告をこの画面で確認します。単発寄付の銀行振込は着金確認後だけ、カードは決済完了分だけを数えます。退会は退会操作をした月（最終更新月）で数えます。</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {monthChoices(current).map((choice) => (
            <Link
              key={choice}
              href={`/admin/reports?ym=${choice}`}
              className={`rounded-full px-3 py-1 text-xs ${choice === ym ? "bg-brand text-white" : "bg-white text-ink-soft"}`}
            >
              {monthLabel(choice)}
            </Link>
          ))}
        </div>
      </div>
      {bundle.loadError ? <p className="no-print rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{bundle.loadError}</p> : null}
      {bundle.saved?.published_at ? (
        <p className="no-print text-sm text-ink-soft">
          会員向けには {new Date(bundle.saved.published_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} 公開分を表示しています。
          <Link className="ml-2 text-brand underline" href={`/mypage/reports/${ym}`}>会員ページを見る</Link>
        </p>
      ) : (
        <p className="no-print text-sm text-ink-soft">この月はまだ会員に公開していません。下の「会員に公開」で収支報告が会員ページに出ます。</p>
      )}
      {bundle.report ? (
        <>
          <ReportView report={bundle.report} expenses={bundle.saved?.expenses ?? emptyExpenses()} note={bundle.saved?.note ?? ""} />
          <ReportEditor
            ym={ym}
            expenses={bundle.saved?.expenses ?? emptyExpenses()}
            horseCount={bundle.saved?.horse_count ?? null}
            note={bundle.saved?.note ?? ""}
            publishedAt={bundle.saved?.published_at ?? null}
            tableMissing={bundle.tableMissing}
          />
        </>
      ) : null}
    </div>
  );
}
