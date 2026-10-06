import type { ReactNode } from "react";
import ReportCharts from "@/components/reports/ReportCharts";
import { formatYen } from "@/lib/format";
import {
  BOARDING_PER_HORSE_YEN,
  EXPENSE_FIELDS,
  SYSTEM_START_YM,
  TREND_ROWS,
  changeRate,
  expenseTotal,
  formatChange,
  hasIncomeAdjustments,
  monthLabel,
  type ExpenseMap,
  type MonthReport,
} from "@/lib/monthlyReport";

/** 一口支援の月額・支援者数・口数が、何を数えたものかを添える。 */
const SUPPORT_BASIS_HINT = {
  billed: "・この月に決済された定期課金",
  live: "・いま有効な定期課金",
  registered: "",
} as const;

/** 手入力の調整がある項目に、システム計算からどう変わったかを 1 行で添える。 */
function AdjustNote({ baseLabel, base, fee, extraLabel, extra }: { baseLabel: string; base: number; fee: number; extraLabel: string; extra: number }) {
  if (fee === 0 && extra === 0) return null;
  return (
    <p className="text-xs text-ink-mute">
      {baseLabel} {formatYen(base)}
      {fee !== 0 ? ` − 決済手数料 ${formatYen(fee)}` : ""}
      {extra !== 0 ? ` ${extra > 0 ? "＋" : "−"} ${extraLabel} ${formatYen(Math.abs(extra))}` : ""}
    </p>
  );
}

const TREND_HEADS = ["今月", "前月", "前々月"] as const;

/**
 * 推移の表の 1 マス。「●名（前月比 ●%）」の形で出す。
 * 集計を始める前の月は数を「—」に、比較先が無い月は前月比を「—」にする。狭い画面では前月比を次の行に送る。
 */
function TrendCell({ value, before, unit, strong }: { value: number | null; before: number | null; unit: string; strong: boolean }) {
  if (value == null) return <span className="text-ink-mute">—</span>;
  const rate = before == null ? null : changeRate(value, before);
  const up = rate != null && rate > 0;
  const down = rate != null && rate < 0;
  return (
    <>
      <span className={`tabular-nums ${strong ? "font-bold" : ""}`}>{value.toLocaleString("ja-JP")}{unit}</span>
      <span className={`block break-keep text-[11px] leading-snug sm:inline-block sm:text-sm ${up ? "text-emerald-700" : down ? "text-rose-700" : "text-ink-soft"}`}>
        （前月比 {formatChange(rate)}）
      </span>
    </>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white px-3 py-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-ink-mute">{hint}</p> : null}
    </div>
  );
}

export default function ReportView({
  report,
  expenses,
  note,
  trendAction,
}: {
  report: MonthReport;
  expenses: ExpenseMap;
  note: string;
  /** 推移の表の見出しの横に置く操作（管理画面の「過去分をダウンロード」）。会員向けの表示では渡さない。 */
  trendAction?: ReactNode;
}) {
  const spent = expenseTotal(expenses);
  const { adjust, system } = report;
  const shareAdjusted = adjust.shareFeeYen !== 0 || adjust.shareExtraYen !== 0;
  const boardingHint =
    report.soldHorses > 0
      ? `${report.rescuedHorses}頭 − 売却・譲渡${report.soldHorses}頭 ＝ ${report.boardingHorses}頭 × ${formatYen(BOARDING_PER_HORSE_YEN)}`
      : `${report.boardingHorses}頭 × ${formatYen(BOARDING_PER_HORSE_YEN)}`;

  return (
    <div className="report-sheet space-y-6">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="会員数" value={`${report.counts.total.toLocaleString("ja-JP")}名`} hint={`新規 ${report.newMembers} / 退会 ${report.withdrawn}`} />
        <Stat label="継続支援者" value={`${report.counts.shareSupporters.toLocaleString("ja-JP")}名`} hint={`${report.counts.shareUnits.toLocaleString("ja-JP")}口`} />
        <Stat label="一口支援の月額" value={formatYen(report.counts.supportYen)} hint={`平均 ${formatYen(report.averageSupportYen)}${SUPPORT_BASIS_HINT[report.supportBasis]}`} />
        <Stat label="今月の単発寄付" value={formatYen(report.donations.total)} hint={`カード ${formatYen(report.donations.card)} / 振込 ${formatYen(report.donations.bank)}`} />
        <Stat label="会費収入" value={formatYen(report.duesYen)} hint={report.teamIncomeYen > 0 ? `うちリタポ・特別チーム ${formatYen(report.teamIncomeYen)}` : undefined} />
        <Stat label="一口支援の入金" value={formatYen(report.shareIncomeYen)} hint={shareAdjusted ? "決済手数料・銀行振込を反映" : undefined} />
        <Stat label="イベント申込" value={`${report.eventBookings.toLocaleString("ja-JP")}件`} hint="取消を除く申込" />
        <Stat label="保護馬の預託" value={formatYen(report.boardingYen)} hint={boardingHint} />
      </section>

      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-x-3">
          <h2 className="section-title">会員種別と一口支援の推移</h2>
          {trendAction ? <div className="mb-2 print:hidden">{trendAction}</div> : null}
        </div>
        <div className="overflow-x-auto">
          {/*
            狭い画面では表の形をやめ、区分を 1 行に出して、その下に今月・前月・前々月を 3 列で並べる。
            sm:table と書くと globals.css の .table（一覧用の装飾）まで付くので、display だけを指定する。
          */}
          <table className="block w-full text-sm sm:[display:table]">
            <thead className="block sm:table-header-group">
              <tr className="grid grid-cols-3 text-left text-ink-soft sm:table-row">
                <th className="hidden py-2 pr-3 font-medium sm:table-cell">区分</th>
                {report.trend.map((month, index) => (
                  <th key={month.ym} className="py-2 pr-1 font-medium sm:pr-3 sm:last:pr-0">
                    {TREND_HEADS[index]}
                    <span className="ml-1 text-xs font-normal text-ink-mute">{Number(month.ym.slice(5))}月</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {TREND_ROWS.map((row) => (
                <tr key={row.key} className="grid grid-cols-3 border-t border-black/5 sm:table-row">
                  <td className={`col-span-3 pt-2 text-xs sm:py-2 sm:pr-3 sm:text-sm ${row.key === "total" ? "font-bold" : "text-ink-soft sm:text-ink"}`}>{row.label}</td>
                  {report.trend.map((month, index) => (
                    <td key={month.ym} className="pb-2 pr-1 align-top sm:py-2 sm:pr-3 sm:last:pr-0">
                      <TrendCell value={month.counts?.[row.key] ?? null} before={month.before?.[row.key] ?? null} unit={row.unit} strong={index === 0} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.trend.some((month) => month.counts == null || month.before == null) ? (
          <p className="mt-2 text-xs text-ink-mute">集計は会員サイトを始めた{monthLabel(SYSTEM_START_YM)}からです。それより前の月と、その月との比較は「—」としています。</p>
        ) : null}
      </section>

      <ReportCharts series={report.series} />

      <section className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="section-title">支援が増えた馬</h2>
          {report.horsesUp.length === 0 ? <p className="text-sm text-ink-soft">前月と同じです。</p> : (
            <ul className="space-y-2 text-sm">
              {report.horsesUp.map((horse) => (
                <li key={horse.id} className="flex justify-between gap-3">
                  <span>{horse.name}</span>
                  <span className="tabular-nums text-emerald-700">+{horse.deltaUnits}口（{horse.units}口）</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="section-title">支援が減った馬</h2>
          {report.horsesDown.length === 0 ? <p className="text-sm text-ink-soft">前月と同じです。</p> : (
            <ul className="space-y-2 text-sm">
              {report.horsesDown.map((horse) => (
                <li key={horse.id} className="flex justify-between gap-3">
                  <span>{horse.name}</span>
                  <span className="tabular-nums text-rose-700">{horse.deltaUnits}口（{horse.units}口）</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">{report.label}の収支</h2>
        <p className="text-sm text-ink-soft">
          単発寄付、会費、一口支援の入金合計 {formatYen(report.incomeYen)} のうち、20%の {formatYen(report.operatingYen)} をRetouchの運営経費、80%の {formatYen(report.careYen)} を馬の保護・管理費に充てています。
        </p>
        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-surface-soft p-3">
            <p className="text-ink-soft">単発寄付</p>
            <p className="font-bold">{formatYen(report.donations.total)}</p>
            <p className="text-xs text-ink-mute">カード {formatYen(report.donations.card)} / 銀行振込（着金確認後）{formatYen(report.donations.bank)}</p>
            <AdjustNote baseLabel="申告のあった寄付" base={system.donationCard + system.donationBank} fee={adjust.donationFeeYen} extraLabel="直接振込" extra={adjust.donationExtraYen} />
          </div>
          <div className="rounded-lg bg-surface-soft p-3">
            <p className="text-ink-soft">会費収入</p>
            <p className="font-bold">{formatYen(report.duesYen)}</p>
            {report.teamIncomeYen > 0 ? <p className="text-xs text-ink-mute">メンバーズ・サポーター・リェリーフ {formatYen(system.duesYen - report.teamIncomeYen)} / リタポ・特別チーム {formatYen(report.teamIncomeYen)}</p> : null}
            <AdjustNote baseLabel="カード決済" base={system.duesYen} fee={adjust.duesFeeYen} extraLabel="銀行振込など" extra={adjust.duesExtraYen} />
          </div>
          <div className="rounded-lg bg-surface-soft p-3">
            <p className="text-ink-soft">一口支援</p>
            <p className="font-bold">{formatYen(report.shareIncomeYen)}</p>
            <AdjustNote baseLabel="カード決済" base={system.shareIncomeYen} fee={adjust.shareFeeYen} extraLabel="銀行振込・引落" extra={adjust.shareExtraYen} />
          </div>
          {report.otherIncomeYen !== 0 ? (
            report.otherIncomeYen > 0 ? (
              <div className="rounded-lg bg-surface-soft p-3"><p className="text-ink-soft">その他の定期入金</p><p className="font-bold">{formatYen(report.otherIncomeYen)}</p><p className="text-xs text-ink-mute">会費・一口支援のどちらにも分けられなかった入金</p></div>
            ) : (
              <div className="rounded-lg bg-surface-soft p-3"><p className="text-ink-soft">その他の返金</p><p className="font-bold">-{formatYen(-report.otherIncomeYen)}</p><p className="text-xs text-ink-mute">以前の月の決済を、この月に返金した分</p></div>
            )
          ) : null}
        </div>
        <p className="mt-2 text-xs text-ink-mute">
          {hasIncomeAdjustments(adjust)
            ? "決済手数料を引いた項目と、銀行振込・引落の分を足した項目は、その内訳を金額の下に示しています。カードの決済は決済された月に数え、返金は返金した月の金額から引いています。"
            : "会費・一口支援・カードの寄付は、その月にカードで決済された金額です（決済手数料を引く前）。返金は、返金した月の金額から引いています。"}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="py-2 pr-3 font-medium">運営経費の内訳</th>
                <th className="py-2 font-medium">金額</th>
              </tr>
            </thead>
            <tbody>
              {EXPENSE_FIELDS.map((field) => (
                <tr key={field.key} className="border-t border-black/5">
                  <td className="py-2 pr-3">{field.label}</td>
                  <td className="py-2 tabular-nums">{formatYen(expenses[field.key])}</td>
                </tr>
              ))}
              <tr className="border-t border-black/10 font-bold">
                <td className="py-2 pr-3">運営経費の合計</td>
                <td className="py-2 tabular-nums">{formatYen(spent)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-mute">
          運営経費に正社員の人件費は含めていません。イベント等で一時的に必要なアルバイト代だけを見学会・イベント費に含めています。馬の預託管理費（1頭あたり月額{formatYen(BOARDING_PER_HORSE_YEN)}、馬事学院・ホースレスト等への委託）は上記の20%とは別に、{report.soldHorses > 0 ? `保護馬${report.rescuedHorses}頭から売却・譲渡した${report.soldHorses}頭を除いた` : ""}{report.boardingHorses}頭で {formatYen(report.boardingYen)} です。
        </p>
        {note ? <p className="mt-3 text-sm whitespace-pre-wrap">{note}</p> : null}
      </section>
    </div>
  );
}
