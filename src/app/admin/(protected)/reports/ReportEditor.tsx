"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatYen } from "@/lib/format";
import {
  ADJUST_ROWS,
  BOARDING_PER_HORSE_YEN,
  EXPENSE_FIELDS,
  adjustIncome,
  parseAdjustments,
  type AdjustRowKey,
  type Adjustments,
  type ExpenseMap,
  type SystemIncome,
} from "@/lib/monthlyReport";

type YenKey = Exclude<keyof Adjustments, "soldHorses">;

/** 0 は空欄で出す。空欄は「調整なし」。 */
function asText(value: number | null): string {
  return value == null || value === 0 ? "" : String(value);
}

export default function ReportEditor({
  ym,
  expenses,
  horseCount,
  adjust,
  system,
  stripeFees,
  horseDefaults,
  note,
  publishedAt,
  tableMissing,
}: {
  ym: string;
  expenses: ExpenseMap;
  horseCount: number | null;
  adjust: Adjustments;
  system: SystemIncome;
  /** Stripe が記録している、その月の決済手数料（区分ごと）。手数料の欄に入れる金額の目安。 */
  stripeFees: Record<AdjustRowKey, number>;
  horseDefaults: { rescued: number; sold: number };
  note: string;
  publishedAt: string | null;
  tableMissing: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"save" | "publish" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 調整と頭数は、入力のたびに「公開する金額」を出し直すので state で持つ。
  const [yen, setYen] = useState<Record<YenKey, string>>({
    donationFeeYen: asText(adjust.donationFeeYen),
    donationExtraYen: asText(adjust.donationExtraYen),
    duesFeeYen: asText(adjust.duesFeeYen),
    duesExtraYen: asText(adjust.duesExtraYen),
    shareFeeYen: asText(adjust.shareFeeYen),
    shareExtraYen: asText(adjust.shareExtraYen),
  });
  const [rescuedText, setRescuedText] = useState(horseCount == null ? "" : String(horseCount));
  const [soldText, setSoldText] = useState(adjust.soldHorses == null ? "" : String(adjust.soldHorses));

  const live = parseAdjustments({ ...yen, soldHorses: soldText.trim() });
  const income = adjustIncome(system, live);
  const rescued = rescuedText.trim() === "" ? horseDefaults.rescued : Math.max(0, Math.round(Number(rescuedText) || 0));
  const sold = Math.min(rescued, live.soldHorses ?? horseDefaults.sold);
  const boarding = rescued - sold;
  const systemOf = { donation: system.donationCard + system.donationBank, dues: system.duesYen, share: system.shareIncomeYen };
  const publishedOf = { donation: income.donations.total, dues: income.duesYen, share: income.shareIncomeYen };

  async function submit(form: HTMLFormElement, publish: boolean) {
    const data = new FormData(form);
    const body = {
      ym,
      publish,
      note: String(data.get("note") ?? ""),
      horseCount: rescuedText.trim() === "" ? null : rescued,
      adjust: live,
      expenses: Object.fromEntries(EXPENSE_FIELDS.map((field) => [field.key, Number(data.get(field.key) || 0)])),
    };
    setPending(publish ? "publish" : "save");
    setMessage(null);
    const res = await fetch("/api/admin/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setPending(null);
    if (!res.ok) {
      setMessage(typeof json.error === "string" ? json.error : "保存に失敗しました。");
      return;
    }
    setMessage(publish ? "会員向けの決済報告を公開しました。" : "下書きを保存しました。");
    router.refresh();
  }

  return (
    <form
      className="card no-print space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget, false);
      }}
    >
      <div className="space-y-3">
        <div>
          <h2 className="section-title">公開する数字の調整（手入力）</h2>
          <p className="text-sm text-ink-soft">
            「システム計算」は Stripe の決済（その月に決済された金額から、その月に返金した金額を引いたもの。手数料を引く前）と、着金を確認した銀行振込の寄付です。実際の入金に合わせる調整を入れると、会員に公開する決済報告は「公開する金額」になります。下書きを保存すると、上の表示にも反映されます。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="py-2 pr-3 font-medium">項目</th>
                <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">システム計算</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">カード決済手数料（引く）</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">銀行振込・引落など（足す）</th>
                <th className="py-2 font-medium text-right whitespace-nowrap">公開する金額</th>
              </tr>
            </thead>
            <tbody>
              {ADJUST_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-black/5 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap font-medium">{row.label}</td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{formatYen(systemOf[row.key])}</td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      aria-label={`${row.label}のカード決済手数料`}
                      value={yen[row.fee]}
                      onChange={(event) => setYen((prev) => ({ ...prev, [row.fee]: event.target.value }))}
                      className="w-32 rounded-lg border px-3 py-2 text-right"
                    />
                    {stripeFees[row.key] > 0 ? (
                      <span className="mt-0.5 block text-xs text-ink-mute">
                        Stripe の記録 {formatYen(stripeFees[row.key])}
                        <button
                          type="button"
                          className="ml-1 text-brand underline"
                          onClick={() => setYen((prev) => ({ ...prev, [row.fee]: String(stripeFees[row.key]) }))}
                        >
                          入れる
                        </button>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label={`${row.label}の銀行振込・引落など`}
                      value={yen[row.extra]}
                      onChange={(event) => setYen((prev) => ({ ...prev, [row.extra]: event.target.value }))}
                      className="w-32 rounded-lg border px-3 py-2 text-right"
                    />
                    <span className="mt-0.5 block text-xs text-ink-mute">{row.extraHint}</span>
                  </td>
                  <td className="py-2 text-right font-bold tabular-nums whitespace-nowrap">{formatYen(publishedOf[row.key])}</td>
                </tr>
              ))}
              <tr className="border-t border-black/10 font-bold">
                <td className="py-2 pr-3">3項目の合計</td>
                <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{formatYen(systemOf.donation + systemOf.dues + systemOf.share)}</td>
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap">−{formatYen(live.donationFeeYen + live.duesFeeYen + live.shareFeeYen)}</td>
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{formatYen(live.donationExtraYen + live.duesExtraYen + live.shareExtraYen)}</td>
                <td className="py-2 text-right tabular-nums whitespace-nowrap">{formatYen(publishedOf.donation + publishedOf.dues + publishedOf.share)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-ink-mute">
          <li>「カード決済手数料」には、カードで決済された金額と、実際に入金された金額の差を入れます。Stripe が記録している手数料は欄の下に出ます。「入れる」を押すと、その金額が入ります。</li>
          <li>「銀行振込・引落など」には、会員サイトの記録にない入金を入れます。数えすぎていた分を引くときは、マイナスで入れます。</li>
          <li>ここで引いた決済手数料は、下の運営経費の「決済関連費」には入れないでください。同じ金額を二重に引くことになります。</li>
          <li>空欄は、調整なしです。</li>
        </ul>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="section-title">保護馬の預託</h2>
          <p className="text-sm text-ink-soft">売却・譲渡した馬は預託から引きます。空欄のままなら、登録されている馬から自動で数えます。</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="font-medium">保護した馬の頭数</span>
            <span className="mt-0.5 block text-xs text-ink-mute">売却・譲渡した馬を含む。空欄なら、故と記載のない馬の数</span>
            <input
              name="horseCount"
              type="number"
              min={0}
              inputMode="numeric"
              value={rescuedText}
              placeholder={String(horseDefaults.rescued)}
              onChange={(event) => setRescuedText(event.target.value)}
              className="mt-1 w-40 rounded-lg border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">うち売却・譲渡した頭数</span>
            <span className="mt-0.5 block text-xs text-ink-mute">空欄なら、名前に「オーナー決定」とある馬の数</span>
            <input
              name="soldHorses"
              type="number"
              min={0}
              inputMode="numeric"
              value={soldText}
              placeholder={String(horseDefaults.sold)}
              onChange={(event) => setSoldText(event.target.value)}
              className="mt-1 w-40 rounded-lg border px-3 py-2"
            />
          </label>
        </div>
        <p className="text-sm">
          預託中 <span className="font-bold tabular-nums">{rescued}頭 − {sold}頭 ＝ {boarding}頭</span> × {formatYen(BOARDING_PER_HORSE_YEN)} ＝ <span className="font-bold tabular-nums">{formatYen(boarding * BOARDING_PER_HORSE_YEN)}</span>
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="section-title">運営経費と公開</h2>
          <p className="text-sm text-ink-soft">
            入力した内訳は、収入の20%として自動計算した運営経費の内訳です。公開すると、その時点の数字が会員向けの決済報告に固定されます。
          </p>
        </div>
        {tableMissing ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            保存用のテーブルがまだありません。Supabaseで supabase/newhorse.sql の末尾（monthly_reports）を実行すると、下書き保存と会員への公開が使えるようになります。画面の集計自体はこのままで確認できます。
          </p>
        ) : null}
        <div className="grid md:grid-cols-2 gap-3">
          {EXPENSE_FIELDS.map((field) => (
            <label key={field.key} className="block text-sm">
              <span className="font-medium">{field.label}</span>
              <span className="mt-0.5 block text-xs text-ink-mute">{field.hint}</span>
              <input name={field.key} type="number" min={0} defaultValue={expenses[field.key] || ""} className="mt-1 w-full rounded-lg border px-3 py-2" />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          <span className="font-medium">会員向けの補足</span>
          <textarea name="note" defaultValue={note} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-secondary" disabled={pending != null || tableMissing}>
            {pending === "save" ? "保存中…" : "下書きを保存"}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={pending != null || tableMissing}
            onClick={(event) => void submit(event.currentTarget.form!, true)}
          >
            {pending === "publish" ? "公開中…" : publishedAt ? "この内容で再公開" : "会員に公開"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => window.print()}>印刷 / PDF保存</button>
          {message ? <p className="text-sm">{message}</p> : null}
        </div>
      </div>
    </form>
  );
}
