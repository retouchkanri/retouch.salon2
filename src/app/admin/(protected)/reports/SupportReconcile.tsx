import Link from "next/link";
import { formatUnits } from "@/lib/format";
import { SUPPORT_MISMATCH_LABEL, type SupportReconciliation } from "@/lib/supportReconcile";

const TH = "py-2 pl-3 font-medium text-right whitespace-nowrap";
const TD = "py-2 pl-3 text-right tabular-nums whitespace-nowrap";

/**
 * 一口支援の、サイトの登録（支援管理）と Stripe の課金の照合。管理者だけが見る。
 * 上の「継続支援者」はサイトの登録の数字なので、Stripe の課金と合わない方をここで確認できるようにする。
 */
export default function SupportReconcile({ data }: { data: SupportReconciliation }) {
  const gap = data.site.units - data.stripe.units;
  return (
    <section className="card no-print">
      <h2 className="section-title">一口支援：サイトの登録と Stripe の照合</h2>
      <p className="text-sm text-ink-soft">
        上の「継続支援者」の人数・口数は、支援管理と同じサイトの登録（状態が「有効」の支援）です。Stripe が実際に課金している定期課金と支援者ごとに比べ、合わない方を下に出しています。
      </p>
      <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg bg-surface-soft p-3">
          <p className="text-ink-soft">サイトの登録（支援管理と同じ）</p>
          <p className="font-bold tabular-nums">{data.site.supporters.toLocaleString("ja-JP")}名・{formatUnits(data.site.units)}</p>
        </div>
        <div className="rounded-lg bg-surface-soft p-3">
          <p className="text-ink-soft">Stripe で支払い中</p>
          <p className="font-bold tabular-nums">{data.stripe.supporters.toLocaleString("ja-JP")}名・{formatUnits(data.stripe.units)}</p>
        </div>
        <div className="rounded-lg bg-surface-soft p-3">
          <p className="text-ink-soft">差（サイト − Stripe）</p>
          <p className="font-bold tabular-nums">{gap === 0 ? "なし" : `${gap > 0 ? "+" : "−"}${formatUnits(Math.abs(gap))}`}</p>
        </div>
      </div>
      <p className="mt-2 text-sm">
        サイトの登録 {formatUnits(data.site.units)} の内訳：Stripe で支払い中 <span className="font-bold tabular-nums">{formatUnits(data.billedUnits)}</span> ＋ Stripe の課金なし（振込・手動登録など）<span className="font-bold tabular-nums">{formatUnits(data.unbilledUnits)}</span>
      </p>

      {data.mismatches.length === 0 ? (
        <p className="mt-3 text-sm">サイトの登録と Stripe の課金は、全員一致しています。</p>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium">口数が合わない方（{data.mismatches.length.toLocaleString("ja-JP")}名）</p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-soft">
                  <th className="py-2 pr-3 text-left font-medium">区分</th>
                  <th className="py-2 pr-3 text-left font-medium">氏名</th>
                  <th className={TH}>サイトの登録</th>
                  <th className={TH}>Stripe で支払い中</th>
                  <th className={TH}>差</th>
                  <th className="py-2 pl-3 text-left font-medium">備考</th>
                </tr>
              </thead>
              <tbody>
                {data.mismatches.map((row, index) => {
                  const diff = row.siteUnits - row.stripeUnits;
                  return (
                    <tr key={row.customerId ?? `stripe-${index}`} className="border-t border-black/5">
                      <td className="py-2 pr-3">{SUPPORT_MISMATCH_LABEL[row.kind]}</td>
                      <td className="py-2 pr-3">
                        {row.customerId ? (
                          <Link className="text-brand underline" href={`/admin/customers/${row.customerId}`}>{row.name}</Link>
                        ) : (
                          <span>{row.name}{row.email ? `（${row.email}）` : ""}</span>
                        )}
                      </td>
                      <td className={TD}>{row.siteUnits === 0 ? "—" : formatUnits(row.siteUnits)}</td>
                      <td className={TD}>{row.stripeUnits === 0 ? "—" : formatUnits(row.stripeUnits)}</td>
                      <td className={`${TD} font-bold`}>{diff > 0 ? "+" : "−"}{formatUnits(Math.abs(diff))}</td>
                      <td className="py-2 pl-3 text-ink-soft">{row.pastDueUnits > 0 ? `Stripe で支払い遅延 ${formatUnits(row.pastDueUnits)}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-mute">
            「サイトにだけある」は、銀行振込・手動登録の支援か、Stripe では終了しているのにサイトで有効のままの支援です。「Stripe にだけある」「Stripe の口数のほうが多い」は、課金されているのにサイトに登録がない支援です。支援管理で登録を直すか、Stripe の定期課金をご確認ください。この画面からは、登録も課金も変わりません。
          </p>
        </>
      )}
    </section>
  );
}
