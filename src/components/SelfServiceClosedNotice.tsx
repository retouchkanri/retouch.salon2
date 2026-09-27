import Link from "next/link";

/**
 * 会員セルフサービス（追加・変更・停止）が無効のときに、各種お手続きページで
 * 表示する案内カード。会員には「運営にて承る」旨を伝え、マイページへ誘導する。
 *
 * 対応するミューテーション API は {@link memberMutationGuard} が 403 で拒否するため、
 * この案内はあくまで導線・説明のためのもの。
 */
export default function SelfServiceClosedNotice({
  title = "お手続きについて",
  description = "各種お手続き（追加・変更・停止）は、現在運営にて承っております。お手数ですが運営までお問い合わせください。",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="card">
        <h1 className="text-lg font-bold mb-2">{title}</h1>
        <p className="text-sm text-ink-soft whitespace-pre-line">{description}</p>
        <div className="mt-4">
          <Link href="/mypage" className="btn-secondary inline-flex">
            マイページへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
