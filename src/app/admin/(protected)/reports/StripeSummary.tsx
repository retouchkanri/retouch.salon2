import Link from "next/link";
import { formatUnits, formatYen } from "@/lib/format";
import type { MonthReport, StripeBucket, StripeKind } from "@/lib/monthlyReport";

const ROWS: { kind: StripeKind; label: string }[] = [
  { kind: "dues", label: "会費（メンバーズ・サポーター・リェリーフ）" },
  { kind: "team", label: "会費（リタポ・特別チーム）" },
  { kind: "share", label: "一口支援" },
  { kind: "donation", label: "単発寄付（カード）" },
  { kind: "other", label: "その他" },
];

const TH = "py-2 pl-3 font-medium text-right whitespace-nowrap";
const TD = "py-2 pl-3 text-right tabular-nums whitespace-nowrap";

const BASIS_LABEL = {
  billed: "この月に Stripe が課金した定期課金",
  live: "いま Stripe で有効な定期課金",
  registered: "サイトの登録（Stripe の記録を読み込めなかったため）",
} as const;

function netOf(bucket: StripeBucket): number {
  return bucket.grossYen - bucket.refundYen - bucket.feeYen;
}

/**
 * Stripe の画面と突き合わせるための集計。Stripe の残高レポート（アクティビティによる残高の変更）と同じく、
 * 決済は決済された日、返金は返金した日で月に入れる。管理者だけが見る。
 */
export default function StripeSummary({ report, otherFees }: { report: MonthReport; otherFees: { yen: number; count: number } | null }) {
  const { stripe } = report;
  const rows = ROWS.filter(({ kind }) => {
    const bucket = stripe.kinds[kind];
    return kind !== "other" || bucket.grossYen !== 0 || bucket.refundYen !== 0;
  });
  const supportGap = report.counts.supportYen - report.registered.supportYen;

  return (
    <section className="card no-print">
      <h2 className="section-title">Stripe の集計（{report.label}）</h2>
      <p className="text-sm text-ink-soft">
        Stripe の「レポート → 残高 → アクティビティによる残高の変更」と同じ数え方です。決済はその月に決済された金額のまま、返金はその月に返金した金額、手数料はその月の決済にかかった金額です。銀行振込は Stripe を通らないので含みません。
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink-soft">
              <th className="py-2 pr-3 text-left font-medium">区分</th>
              <th className={TH}>売上（決済額）</th>
              <th className={TH}>返金</th>
              <th className={TH}>決済手数料</th>
              <th className={TH}>入金額（純額）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ kind, label }) => {
              const bucket = stripe.kinds[kind];
              return (
                <tr key={kind} className="border-t border-black/5">
                  <td className="py-2 pr-3">{label}</td>
                  <td className={TD}>{formatYen(bucket.grossYen)}</td>
                  <td className={TD}>{bucket.refundYen === 0 ? "—" : `−${formatYen(bucket.refundYen)}`}</td>
                  <td className={TD}>{bucket.feeYen === 0 ? "—" : `−${formatYen(bucket.feeYen)}`}</td>
                  <td className={`${TD} font-bold`}>{formatYen(netOf(bucket))}</td>
                </tr>
              );
            })}
            <tr className="border-t border-black/10 font-bold">
              <td className="py-2 pr-3">合計（決済 {stripe.payments.toLocaleString("ja-JP")}件・返金 {stripe.refunds.toLocaleString("ja-JP")}件）</td>
              <td className={TD}>{formatYen(stripe.total.grossYen)}</td>
              <td className={TD}>{stripe.total.refundYen === 0 ? "—" : `−${formatYen(stripe.total.refundYen)}`}</td>
              <td className={TD}>{stripe.total.feeYen === 0 ? "—" : `−${formatYen(stripe.total.feeYen)}`}</td>
              <td className={TD}>{formatYen(netOf(stripe.total))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {otherFees && otherFees.yen !== 0 ? (
        <p className="mt-2 text-sm">
          このほかに、決済ごとの手数料とは別の Stripe の利用料（Billing の利用料、Sigma など {otherFees.count.toLocaleString("ja-JP")}件）が <span className="font-bold tabular-nums">{formatYen(otherFees.yen)}</span> 引かれています。これも引いた Stripe からの純額は <span className="font-bold tabular-nums">{formatYen(netOf(stripe.total) - otherFees.yen)}</span> です。
        </p>
      ) : null}
      {stripe.feeMissing > 0 ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          手数料がまだ記録されていない決済が {stripe.feeMissing.toLocaleString("ja-JP")}件あります。決済手数料と入金額は、その分だけ実際と違います。決済履歴の「Stripe と同期」で取り直せます。
        </p>
      ) : null}
      <div className="mt-4 rounded-lg bg-surface-soft p-3 text-sm">
        <p className="font-medium">一口支援の月額</p>
        <p className="mt-1">
          Stripe：<span className="font-bold tabular-nums">{formatYen(report.counts.supportYen)}</span>（{report.counts.shareSupporters}名・{formatUnits(report.counts.shareUnits)}）
          <span className="text-ink-mute"> … {BASIS_LABEL[report.supportBasis]}</span>
        </p>
        {report.supportPastDueYen > 0 ? <p className="text-ink-mute">ほかに、支払いが遅れている定期課金が {formatYen(report.supportPastDueYen)} あります。</p> : null}
        {report.supportBasis !== "registered" ? (
          <p className="mt-1">
            サイトの登録：<span className="tabular-nums">{formatYen(report.registered.supportYen)}</span>（{report.registered.shareSupporters}名・{formatUnits(report.registered.shareUnits)}）
            {supportGap !== 0 ? (
              <>
                {" "}→ 差 <span className={`font-bold tabular-nums ${supportGap > 0 ? "text-rose-700" : ""}`}>{supportGap > 0 ? "+" : "−"}{formatYen(Math.abs(supportGap))}</span>。
                サイトの登録には銀行振込・口座引落の支援も入ります。Stripe の方が多いときは、登録もれの支援があります。
                <Link className="ml-1 text-brand underline" href="/admin/supports">支援の登録を見る</Link>
              </>
            ) : "（一致）"}
          </p>
        ) : null}
      </div>
    </section>
  );
}
