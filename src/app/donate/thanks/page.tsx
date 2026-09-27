import Link from "next/link";
import { formatYen } from "@/lib/format";
import { getBankTransferInfo } from "@/lib/bankTransfer";

export default function PublicDonateThanksPage({
  searchParams,
}: {
  searchParams: { method?: string; amount?: string };
}) {
  const isBank = searchParams.method === "bank";

  if (isBank) {
    const bank = getBankTransferInfo();
    const amountNum = Number(searchParams.amount);
    const amount = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : null;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="card max-w-md w-full space-y-4">
            <div className="text-center space-y-2">
              <h1 className="text-xl font-bold">お申し込みを受け付けました</h1>
              <p className="text-ink-soft text-sm">
                下記の口座へお振込をお願いいたします。<br />
                振込先のご案内メールもお送りしておりますのでご確認ください。
              </p>
            </div>

            {amount && (
              <div className="rounded-xl bg-brand-50 border border-brand-light px-4 py-3 text-center">
                <p className="text-xs text-ink-soft">お振込金額</p>
                <p className="text-2xl font-bold text-brand">{formatYen(amount)}</p>
              </div>
            )}

            <dl className="rounded-xl border border-surface-line divide-y divide-surface-line text-sm">
              <div className="flex justify-between gap-3 px-4 py-2">
                <dt className="text-ink-soft">銀行名</dt>
                <dd className="font-semibold text-right">{bank.bankName}</dd>
              </div>
              <div className="flex justify-between gap-3 px-4 py-2">
                <dt className="text-ink-soft">支店名</dt>
                <dd className="font-semibold text-right">{bank.branchName}</dd>
              </div>
              <div className="flex justify-between gap-3 px-4 py-2">
                <dt className="text-ink-soft">口座種別</dt>
                <dd className="font-semibold text-right">{bank.accountType}</dd>
              </div>
              <div className="flex justify-between gap-3 px-4 py-2">
                <dt className="text-ink-soft">口座番号</dt>
                <dd className="font-semibold text-right tabular-nums">{bank.accountNumber}</dd>
              </div>
            </dl>

            <p className="text-xs text-ink-mute">
              {bank.note ? `${bank.note} ` : ""}
              恐れ入りますが、振込手数料はご負担いただきますようお願いいたします。
              入金確認後、あらためて受領のご連絡をお送りいたします。
            </p>

            <div className="flex flex-col gap-2 pt-1">
              <Link href="/signup" className="btn-primary">
                会員登録して継続支援を検討する
              </Link>
              <Link href="/" className="btn-ghost">
                トップへ戻る
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center space-y-3">
          <p className="text-3xl">💚</p>
          <h1 className="text-xl font-bold">ご寄付をお預かりしました</h1>
          <p className="text-ink-soft">
            ご寄付ありがとうございました。受付が完了しました。<br />
            確認メールをお送りしておりますので、ご確認ください。
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Link href="/signup" className="btn-primary">
              会員登録して継続支援を検討する
            </Link>
            <Link href="/" className="btn-ghost">
              トップへ戻る
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
