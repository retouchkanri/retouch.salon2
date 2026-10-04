import ReportCharts from "@/components/reports/ReportCharts";
import { formatYen } from "@/lib/format";
import {
  BOARDING_PER_HORSE_YEN,
  EXPENSE_FIELDS,
  changeRate,
  expenseTotal,
  formatChange,
  type ExpenseMap,
  type MonthReport,
} from "@/lib/monthlyReport";

function Rate({ current, previous }: { current: number; previous: number }) {
  const rate = changeRate(current, previous);
  const up = rate != null && rate > 0;
  const down = rate != null && rate < 0;
  return (
    <span className={up ? "text-emerald-700" : down ? "text-rose-700" : "text-ink-soft"}>
      前月比 {formatChange(rate)}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
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
}: {
  report: MonthReport;
  expenses: ExpenseMap;
  note: string;
}) {
  const spent = expenseTotal(expenses);
  const rows = [
    ["無料会員", report.counts.free, report.previous.free, report.yearAgo.free],
    ["メンバーズ会員", report.counts.members, report.previous.members, report.yearAgo.members],
    ["サポーター会員", report.counts.supportersPlan, report.previous.supportersPlan, report.yearAgo.supportersPlan],
    ["リェリーフ会員", report.counts.relief, report.previous.relief, report.yearAgo.relief],
    ["一口支援者数", report.counts.shareSupporters, report.previous.shareSupporters, report.yearAgo.shareSupporters],
    ["一口支援数", report.counts.shareUnits, report.previous.shareUnits, report.yearAgo.shareUnits],
  ] as const;

  return (
    <div className="report-sheet space-y-6">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="会員数" value={`${report.counts.total.toLocaleString("ja-JP")}名`} hint={`新規 ${report.newMembers} / 退会 ${report.withdrawn}`} />
        <Stat label="継続支援者" value={`${report.counts.shareSupporters.toLocaleString("ja-JP")}名`} hint={`${report.counts.shareUnits.toLocaleString("ja-JP")}口`} />
        <Stat label="一口支援の月額" value={formatYen(report.counts.supportYen)} hint={`平均 ${formatYen(report.averageSupportYen)}`} />
        <Stat label="今月の単発寄付" value={formatYen(report.donations.total)} hint={`カード ${formatYen(report.donations.card)} / 振込 ${formatYen(report.donations.bank)}`} />
        <Stat label="会費収入" value={formatYen(report.duesYen)} />
        <Stat label="一口支援の入金" value={formatYen(report.shareIncomeYen)} />
        <Stat label="イベント申込" value={`${report.eventBookings.toLocaleString("ja-JP")}件`} hint="取消を除く申込" />
        <Stat label="保護馬の預託" value={formatYen(report.boardingYen)} hint={`${report.boardingHorses}頭 × ${formatYen(BOARDING_PER_HORSE_YEN)}`} />
      </section>

      <section className="card">
        <h2 className="section-title">会員種別と一口支援の推移</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="py-2 pr-3 font-medium">区分</th>
                <th className="py-2 pr-3 font-medium">今月</th>
                <th className="py-2 pr-3 font-medium">前月比</th>
                <th className="py-2 font-medium">前年同月比</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, current, previous, yearAgo]) => (
                <tr key={label} className="border-t border-black/5">
                  <td className="py-2 pr-3">{label}</td>
                  <td className="py-2 pr-3 tabular-nums font-bold">{current.toLocaleString("ja-JP")}</td>
                  <td className="py-2 pr-3"><Rate current={current} previous={previous} /></td>
                  <td className="py-2 text-ink-soft">前年比 {formatChange(changeRate(current, yearAgo))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          単発寄付、会費、一口支援の入金合計 {formatYen(report.incomeYen)} のうち、20%の {formatYen(report.operatingYen)} をRetouchの運営経費、80%の {formatYen(report.careYen)} を梅の保護・管理費に充てています。
        </p>
        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-surface-soft p-3"><p className="text-ink-soft">単発寄付</p><p className="font-bold">{formatYen(report.donations.total)}</p><p className="text-xs text-ink-mute">カード {formatYen(report.donations.card)} / 銀行振込（着金確認後）{formatYen(report.donations.bank)}</p></div>
          <div className="rounded-lg bg-surface-soft p-3"><p className="text-ink-soft">会費収入</p><p className="font-bold">{formatYen(report.duesYen)}</p></div>
          <div className="rounded-lg bg-surface-soft p-3"><p className="text-ink-soft">一口支援</p><p className="font-bold">{formatYen(report.shareIncomeYen)}</p></div>
        </div>
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
          運営経費に正社員の人件費は含めていません。イベント等で一時的に必要なアルバイト代だけを見学会・イベント費に含めています。馬の預託管理費（1頭あたり月額{formatYen(BOARDING_PER_HORSE_YEN)}、馬事学院・ホースレスト等への委託）は上記の20%とは別に、{report.boardingHorses}頭で {formatYen(report.boardingYen)} です。
        </p>
        {note ? <p className="mt-3 text-sm whitespace-pre-wrap">{note}</p> : null}
      </section>
    </div>
  );
}
