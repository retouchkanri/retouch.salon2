import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { LEGACY_END_YM, buildLegacySummary, eraMonthLabel, isLegacyMonth, legacyPeriodLabel } from "@/lib/legacyReport";
import { SYSTEM_START_YM, currentYearMonth, emptyExpenses, formatYearMonth, monthLabel, parseYearMonth, shiftMonth } from "@/lib/monthlyReport";
import { loadReportBundle, loadSavedReport } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import LegacyReportView from "@/components/reports/LegacyReportView";
import ReportView from "@/components/reports/ReportView";
import LegacyPublisher from "./LegacyPublisher";
import ReportEditor from "./ReportEditor";
import StripeSummary from "./StripeSummary";

export const dynamic = "force-dynamic";

const PRINT_STYLE = `@media print { body * { visibility: hidden; } .report-sheet, .report-sheet * { visibility: visible; } .report-sheet { position: absolute; left: 0; top: 0; width: 100%; background: white; } }`;

/** 月次の集計は会員サイトを始めた月から。直近18か月までを新しい順に並べる。 */
function monthChoices(current: string): string[] {
  const parsed = parseYearMonth(current)!;
  return Array.from({ length: 18 }, (_, index) => {
    const point = shiftMonth(parsed.year, parsed.month, -index);
    return formatYearMonth(point.year, point.month);
  }).filter((choice) => choice >= SYSTEM_START_YM);
}

function PublishedLine({ publishedAt, href, unpublished }: { publishedAt: string | null; href: string; unpublished: string }) {
  if (!publishedAt) return <p className="no-print text-sm text-ink-soft">{unpublished}</p>;
  return (
    <p className="no-print text-sm text-ink-soft">
      会員向けには {new Date(publishedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} 公開分を表示しています。
      <Link className="ml-2 text-brand underline" href={href}>会員ページを見る</Link>
    </p>
  );
}

export default async function AdminReportsPage({ searchParams }: { searchParams: { ym?: string } }) {
  await requireCapability("payments.manage");
  const current = currentYearMonth();
  const requested = parseYearMonth(searchParams.ym ?? "") ? searchParams.ym! : current;
  const ym = requested > current ? current : requested;
  // システム開始前の月は、月ごとの集計ではなく、公開済みの収支をまとめた 1 枚を出す。
  const legacy = isLegacyMonth(ym);

  return (
    <div className="space-y-4">
      <style>{PRINT_STYLE}</style>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">経営管理</h1>
          <p className="mt-1 text-sm text-ink-soft">会員、支援、寄付、馬ごとの増減と、月次の決済報告をこの画面で確認します。単発寄付の銀行振込は着金確認後だけ、カードは決済完了分だけを数えます。退会は退会操作をした月（最終更新月）で数えます。</p>
          <p className="mt-1 text-sm text-ink-soft">月ごとの集計は、会員サイトを始めた{monthLabel(SYSTEM_START_YM)}（{eraMonthLabel(SYSTEM_START_YM)}）からです。それより前の{legacyPeriodLabel()}は、公開済みの収支を「システム開始前」にまとめています。</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {monthChoices(current).map((choice) => (
            <Link
              key={choice}
              href={`/admin/reports?ym=${choice}`}
              className={`rounded-full px-3 py-1 text-xs ${!legacy && choice === ym ? "bg-brand text-white" : "bg-white text-ink-soft"}`}
            >
              {monthLabel(choice)}
            </Link>
          ))}
          <Link
            href={`/admin/reports?ym=${LEGACY_END_YM}`}
            className={`rounded-full px-3 py-1 text-xs ${legacy ? "bg-brand text-white" : "bg-white text-ink-soft"}`}
          >
            システム開始前（〜{monthLabel(LEGACY_END_YM)}）
          </Link>
        </div>
      </div>
      {legacy ? <LegacySection /> : <MonthSection ym={ym} />}
    </div>
  );
}

async function LegacySection() {
  const loaded = await loadSavedReport(createSupabaseAdminClient(), LEGACY_END_YM).catch(() => ({
    saved: null,
    tableMissing: false,
    error: "公開の状態を読み込めませんでした。",
  }));
  const note = loaded.saved?.note ?? "";
  return (
    <>
      {loaded.error && !loaded.tableMissing ? <p className="no-print rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{loaded.error}</p> : null}
      <PublishedLine
        publishedAt={loaded.saved?.published_at ?? null}
        href={`/mypage/reports/${LEGACY_END_YM}`}
        unpublished="システム開始前のまとめは、まだ会員に公開していません。下の「会員に公開」で会員ページに出ます。"
      />
      <LegacyReportView summary={buildLegacySummary()} note={note} />
      <LegacyPublisher
        ym={LEGACY_END_YM}
        note={note}
        publishedAt={loaded.saved?.published_at ?? null}
        tableMissing={loaded.tableMissing}
      />
    </>
  );
}

async function MonthSection({ ym }: { ym: string }) {
  const bundle = await loadReportBundle(ym).catch((error: unknown) => ({
    report: null,
    saved: null,
    tableMissing: false,
    loadError: error instanceof Error ? error.message : "集計を読み込めませんでした。",
  }));
  return (
    <>
      {bundle.loadError ? <p className="no-print rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{bundle.loadError}</p> : null}
      <PublishedLine
        publishedAt={bundle.saved?.published_at ?? null}
        href={`/mypage/reports/${ym}`}
        unpublished="この月はまだ会員に公開していません。下の「会員に公開」で決済報告が会員ページに出ます。"
      />
      {bundle.report ? (
        <>
          {bundle.report.otherIncomeYen > 0 ? (
            <p className="no-print rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              会費にも一口支援にも分けられなかった定期入金が {bundle.report.otherIncomeYen.toLocaleString("ja-JP")}円あります。収入の合計には入っています。公開の前に、決済履歴で内容をご確認ください。
            </p>
          ) : null}
          <p className="no-print text-sm text-ink-soft">
            下の表示は、保存済みの手入力を反映した、会員に公開する数字です。自動計算のままの数字は、その下の「公開する数字の調整」の「システム計算」で確認できます。
          </p>
          <ReportView
            report={bundle.report}
            expenses={bundle.saved?.expenses ?? emptyExpenses()}
            note={bundle.saved?.note ?? ""}
            trendAction={
              <a
                href="/api/admin/reports/history"
                className="btn-secondary text-xs sm:!px-3 sm:!py-1"
                title={`${monthLabel(SYSTEM_START_YM)}から今月までの各月を、1か月1行のCSVで保存します。`}
              >
                過去分をダウンロード（CSV）
              </a>
            }
          />
          <StripeSummary report={bundle.report} otherFees={bundle.otherStripeFees ?? null} />
          {/* 月を切り替えたら入力欄を作り直す。前の月の入力が残らないようにする。 */}
          <ReportEditor
            key={ym}
            ym={ym}
            stripeFees={{
              donation: bundle.report.stripe.kinds.donation.feeYen,
              dues: bundle.report.stripe.kinds.dues.feeYen + bundle.report.stripe.kinds.team.feeYen,
              share: bundle.report.stripe.kinds.share.feeYen,
            }}
            expenses={bundle.saved?.expenses ?? emptyExpenses()}
            horseCount={bundle.saved?.horse_count ?? null}
            adjust={bundle.report.adjust}
            system={bundle.report.system}
            horseDefaults={bundle.report.horseDefaults}
            note={bundle.saved?.note ?? ""}
            publishedAt={bundle.saved?.published_at ?? null}
            tableMissing={bundle.tableMissing}
          />
        </>
      ) : null}
    </>
  );
}
