import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { buildGivingInsight } from "@/lib/donationInsight";
import { formatYen } from "@/lib/format";
import { currentYearMonth, formatYearMonth, monthLabel, parseYearMonth, shiftMonth } from "@/lib/monthlyReport";
import { loadReportSource } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import SignalList from "@/components/admin/SignalList";

export const dynamic = "force-dynamic";

function monthChoices(current: string): string[] {
  const parsed = parseYearMonth(current)!;
  return Array.from({ length: 12 }, (_, index) => {
    const point = shiftMonth(parsed.year, parsed.month, -index);
    return formatYearMonth(point.year, point.month);
  });
}

export default async function GivingReportPage({ searchParams }: { searchParams: { ym?: string } }) {
  await requireCapability("payments.manage");
  const current = currentYearMonth();
  const requested = parseYearMonth(searchParams.ym ?? "") ? searchParams.ym! : current;
  const ym = requested > current ? current : requested;
  const loaded = await loadReportSource(createSupabaseAdminClient()).catch((error: unknown) => ({
    source: null,
    error: error instanceof Error ? error.message : "集計を読み込めませんでした。",
  }));
  const insight = loaded.source ? buildGivingInsight(loaded.source, ym) : null;
  const maxSlice = Math.max(1, ...(insight?.slices.map((slice) => Math.max(slice.current, slice.previous)) ?? [1]));
  const incomeTotal = insight?.slices.reduce((sum, slice) => sum + slice.current, 0) ?? 0;
  const dropped = insight?.slices.filter((slice) => slice.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  const horsesDown = insight?.horses.filter((horse) => horse.deltaYen < 0) ?? [];
  const horsesUp = [...(insight?.horses ?? [])].filter((horse) => horse.deltaYen > 0).sort((a, b) => b.deltaYen - a.deltaYen);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">寄付状況</h1>
          <p className="mt-1 text-sm text-ink-soft">経営管理の収入が動いたとき、定期の会費・一口支援・単発寄付・馬ごとの月額のどれが動いたかを見ます。</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {monthChoices(current).map((choice) => (
            <Link key={choice} href={`/admin/giving?ym=${choice}`} className={`rounded-full px-3 py-1 text-xs ${choice === ym ? "bg-brand text-white" : "bg-white text-ink-soft"}`}>
              {monthLabel(choice)}
            </Link>
          ))}
        </div>
      </div>
      {loaded.error ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{loaded.error}</p> : null}
      {insight ? (
        <>
          <SignalList signals={insight.signals} bright={insight.bright} />
          <section className="card">
            <h2 className="section-title">{monthLabel(ym)}は先月より {insight.incomeDelta < 0 ? "" : "+"}{formatYen(insight.incomeDelta)}</h2>
            <p className="text-sm text-ink-soft">
              {insight.incomeDelta < 0 && dropped
                ? `減った一番大きい項目は「${dropped.label}」です（${formatYen(dropped.delta)}）。`
                : insight.incomeDelta > 0
                  ? "先月より収入が増えています。下の項目で、どこが増えたかを確認できます。"
                  : "収入の合計は先月と同じです。内訳に動きがないかも、下で確認できます。"}
            </p>
            <div className="mt-4 space-y-3">
              {insight.slices.map((slice) => (
                <div key={slice.key}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span>{slice.label}</span>
                    <span className={`tabular-nums font-bold ${slice.delta < 0 ? "text-rose-700" : slice.delta > 0 ? "text-emerald-700" : ""}`}>
                      {formatYen(slice.current)}（{slice.delta > 0 ? "+" : ""}{formatYen(slice.delta)}）
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-surface-soft">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (slice.current / maxSlice) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-mute">先月 {formatYen(slice.previous)}</p>
                </div>
              ))}
            </div>
            {incomeTotal > 0 ? (
              <div className="mt-4 flex h-3 overflow-hidden rounded-full">
                {insight.slices.map((slice) => (
                  <div key={slice.key} className="h-full" style={{ width: `${(slice.current / incomeTotal) * 100}%`, background: slice.key === "dues" ? "#1b4332" : slice.key === "share" ? "#2d6a4f" : slice.key === "card" ? "#52b788" : "#95d5b2" }} title={slice.label} />
                ))}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-ink-mute">帯は今月の収入に占める割合です。左から会費、一口支援、カードの単発寄付、銀行振込です。継続支援者 {insight.current.counts.shareSupporters}名、一口の平均 {formatYen(insight.current.averageSupportYen)}。</p>
          </section>
          <section className="grid md:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="section-title">支援額が減った馬</h2>
              {horsesDown.length === 0 ? <p className="text-sm text-ink-soft">減った馬はありません。</p> : (
                <ul className="space-y-2 text-sm">
                  {horsesDown.map((horse) => (
                    <li key={horse.id} className="flex justify-between gap-3">
                      <span>{horse.name}</span>
                      <span className="tabular-nums text-rose-700">{formatYen(horse.deltaYen)}（{horse.currentUnits}口）</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h2 className="section-title">支援額が増えた馬</h2>
              {horsesUp.length === 0 ? <p className="text-sm text-ink-soft">増えた馬はありません。</p> : (
                <ul className="space-y-2 text-sm">
                  {horsesUp.map((horse) => (
                    <li key={horse.id} className="flex justify-between gap-3">
                      <span>{horse.name}</span>
                      <span className="tabular-nums text-emerald-700">+{formatYen(horse.deltaYen)}（{horse.currentUnits}口）</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          {insight.declining.length > 0 ? (
            <section className="card">
              <h2 className="section-title">3か月連続で口数が減っている馬</h2>
              <ul className="space-y-1 text-sm">
                {insight.declining.map((horse) => (
                  <li key={horse.id}>{horse.name}（{horse.months.join(" → ")}口）</li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-sm text-ink-soft">馬ごとの近況文と写真からの報告書は <Link className="text-brand underline" href="/admin/horse-reports">馬の報告</Link> で作り、会員に公開できます。</p>
        </>
      ) : null}
    </div>
  );
}
