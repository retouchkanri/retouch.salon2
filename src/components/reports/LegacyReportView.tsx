import LegacyCharts from "@/components/reports/LegacyCharts";
import { Stat } from "@/components/reports/ReportView";
import { formatYen } from "@/lib/format";
import {
  HALF_EXPENSE_FIELDS,
  HALF_INCOME_FIELDS,
  eraMonthLabel,
  type LegacySummary,
} from "@/lib/legacyReport";
import { SYSTEM_START_YM } from "@/lib/monthlyReport";

/** 赤字は「-¥507,312」と書く。formatYen のままだと「¥-507,312」になる。 */
function signedYen(amount: number): string {
  return amount < 0 ? `-${formatYen(-amount)}` : formatYen(amount);
}

const TH = "py-2 pl-3 font-medium text-right whitespace-nowrap";
const TD = "py-2 pl-3 text-right tabular-nums whitespace-nowrap";

export default function LegacyReportView({ summary, note }: { summary: LegacySummary; note: string }) {
  const { totals, half } = summary;
  return (
    <div className="report-sheet space-y-6">
      <section className="card">
        <h2 className="section-title">システム開始前の収支まとめ（{summary.label}）</h2>
        <p className="text-sm text-ink-soft">
          Retouchの活動を始めた{eraMonthLabel(summary.startYm)}から、会員サイトで集計を始める前の{eraMonthLabel(summary.endYm)}までの収支です。会員の皆さまへ公開済みの「Retouch売上確認表」と「収支報告【前期】{half.label}」の数字をまとめています。{eraMonthLabel(SYSTEM_START_YM)}からは、月ごとの決済報告をご覧ください。
        </p>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="収入の合計" value={formatYen(totals.totalYen)} hint={`${totals.months}か月（${summary.label}）`} />
        <Stat label="会費収入" value={formatYen(totals.duesYen)} hint="会費・支援金" />
        <Stat label="入金収入" value={formatYen(totals.depositYen)} hint="寄付・YouTube収益・馬の売却" />
        <Stat
          label={`${eraMonthLabel(summary.endYm)}末の繰越残高`}
          value={signedYen(half.carriedOutYen)}
          hint={`前期繰越 ${formatYen(half.carriedInYen)} / ${half.label}の収支 ${signedYen(half.balanceYen)}`}
        />
      </section>

      <section className="card">
        <h2 className="section-title">年ごとの収入</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft">
                <th className="py-2 pr-3 text-left font-medium">年</th>
                <th className={TH}>会費収入</th>
                <th className={TH}>入金収入</th>
                <th className={TH}>合計</th>
              </tr>
            </thead>
            <tbody>
              {summary.years.map((row) => (
                <tr key={row.year} className="border-t border-black/5">
                  <td className="py-2 pr-3 whitespace-nowrap">{row.label}</td>
                  <td className={TD}>{formatYen(row.duesYen)}</td>
                  <td className={TD}>{formatYen(row.depositYen)}</td>
                  <td className={`${TD} font-bold`}>{formatYen(row.totalYen)}</td>
                </tr>
              ))}
              <tr className="border-t border-black/10 font-bold">
                <td className="py-2 pr-3 whitespace-nowrap">合計</td>
                <td className={TD}>{formatYen(totals.duesYen)}</td>
                <td className={TD}>{formatYen(totals.depositYen)}</td>
                <td className={TD}>{formatYen(totals.totalYen)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <LegacyCharts months={summary.months} />

      <section className="card">
        <h2 className="section-title">{half.label}の収支</h2>
        <p className="text-sm text-ink-soft">
          収入 {formatYen(half.incomeTotals.totalYen)} に対して支出は {formatYen(half.expenseTotals.totalYen)} で、この期間の収支は {signedYen(half.balanceYen)} です。前期繰越額 {formatYen(half.carriedInYen)} と合わせた{eraMonthLabel(summary.endYm)}末の繰越残高は {signedYen(half.carriedOutYen)} です。
        </p>
        <h3 className="mt-4 text-sm font-bold">収入の部</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft">
                <th className="py-2 pr-3 text-left font-medium">月</th>
                {HALF_INCOME_FIELDS.map((field) => <th key={field.key} className={TH}>{field.label}</th>)}
                <th className={TH}>合計</th>
              </tr>
            </thead>
            <tbody>
              {half.income.map((row) => (
                <tr key={row.ym} className="border-t border-black/5">
                  <td className="py-2 pr-3 whitespace-nowrap">{row.label}</td>
                  {HALF_INCOME_FIELDS.map((field) => <td key={field.key} className={TD}>{row[field.key] === 0 ? "—" : formatYen(row[field.key])}</td>)}
                  <td className={`${TD} font-bold`}>{formatYen(row.totalYen)}</td>
                </tr>
              ))}
              <tr className="border-t border-black/10 font-bold">
                <td className="py-2 pr-3 whitespace-nowrap">合計</td>
                {HALF_INCOME_FIELDS.map((field) => <td key={field.key} className={TD}>{formatYen(half.incomeTotals[field.key])}</td>)}
                <td className={TD}>{formatYen(half.incomeTotals.totalYen)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3 className="mt-5 text-sm font-bold">支出の部</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft">
                <th className="py-2 pr-3 text-left font-medium">月</th>
                {HALF_EXPENSE_FIELDS.map((field) => <th key={field.key} className={TH}>{field.label}</th>)}
                <th className={TH}>合計</th>
              </tr>
            </thead>
            <tbody>
              {half.expenses.map((row) => (
                <tr key={row.ym} className="border-t border-black/5">
                  <td className="py-2 pr-3 whitespace-nowrap">{row.label}</td>
                  {HALF_EXPENSE_FIELDS.map((field) => <td key={field.key} className={TD}>{row[field.key] === 0 ? "—" : formatYen(row[field.key])}</td>)}
                  <td className={`${TD} font-bold`}>{formatYen(row.totalYen)}</td>
                </tr>
              ))}
              <tr className="border-t border-black/10 font-bold">
                <td className="py-2 pr-3 whitespace-nowrap">合計</td>
                {HALF_EXPENSE_FIELDS.map((field) => <td key={field.key} className={TD}>{formatYen(half.expenseTotals[field.key])}</td>)}
                <td className={TD}>{formatYen(half.expenseTotals.totalYen)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-surface-soft p-3"><p className="text-ink-soft">この期間の収支（収入 − 支出）</p><p className={`font-bold ${half.balanceYen < 0 ? "text-rose-700" : ""}`}>{signedYen(half.balanceYen)}</p></div>
          <div className="rounded-lg bg-surface-soft p-3"><p className="text-ink-soft">前期繰越額</p><p className="font-bold">{formatYen(half.carriedInYen)}</p></div>
          <div className="rounded-lg bg-surface-soft p-3"><p className="text-ink-soft">{eraMonthLabel(summary.endYm)}末の繰越残高</p><p className="font-bold">{signedYen(half.carriedOutYen)}</p></div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">月ごとの収入</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft">
                <th className="py-2 pr-3 text-left font-medium">月</th>
                <th className={TH}>会費収入</th>
                <th className={TH}>入金収入</th>
                <th className={TH}>合計</th>
              </tr>
            </thead>
            <tbody>
              {summary.months.map((row) => (
                <tr key={row.ym} className="border-t border-black/5">
                  <td className="py-2 pr-3 whitespace-nowrap">{row.label}</td>
                  <td className={TD}>{formatYen(row.duesYen)}</td>
                  <td className={TD}>{formatYen(row.depositYen)}</td>
                  <td className={`${TD} font-bold`}>{formatYen(row.totalYen)}</td>
                </tr>
              ))}
              <tr className="border-t border-black/10 font-bold">
                <td className="py-2 pr-3 whitespace-nowrap">合計</td>
                <td className={TD}>{formatYen(totals.duesYen)}</td>
                <td className={TD}>{formatYen(totals.depositYen)}</td>
                <td className={TD}>{formatYen(totals.totalYen)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">数字の見かた</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {summary.notes.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {note ? <p className="mt-3 text-sm whitespace-pre-wrap">{note}</p> : null}
      </section>
    </div>
  );
}
