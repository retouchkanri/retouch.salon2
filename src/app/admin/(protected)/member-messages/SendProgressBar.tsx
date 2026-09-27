"use client";
import type { SendProgress } from "@/lib/memberMessagesClient";

/**
 * 一斉配信の進捗バー。新規作成フォームと配信詳細ページの両方で使う共通表示。
 *
 * 配信は1回のHTTP呼び出しで送り切れないため、クライアントが送信APIを繰り返し
 * 呼び出しながら進捗を受け取る（sendMemberMessageUntilDone の onProgress）。
 * ここではその都度の件数を「送信済み / 全体」として描画する。
 *
 * 全体件数（recipientCount）は最初の応答が返るまで 0 のため、その間は
 * 割合を出さず「送信 N 件」とだけ表示する（0% で止まって見えるのを避ける）。
 */
export default function SendProgressBar({
  progress,
  done = false,
  failedCount = 0,
}: {
  progress: SendProgress | null;
  /** 送信完了後も 100% のまま表示し続ける場合に true。 */
  done?: boolean;
  failedCount?: number;
}) {
  if (!progress) return null;

  const total = progress.recipientCount ?? 0;
  const sent = progress.sentCount ?? 0;
  const known = total > 0;
  const pct = known ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  // 残数はサーバが数えた未送信(pending)件数をそのまま使う。
  // total - sent で計算すると、失敗(failed)・対象外(skipped)の行まで
  // 「これから送る件数」に混ざってしまい実態とずれる。
  const remaining = Math.max(0, progress.remaining ?? 0);

  return (
    <div className="w-full max-w-md space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink tabular-nums">
          {done ? "送信完了" : "配信中…"}{" "}
          <span className="tabular-nums">
            {sent.toLocaleString("ja-JP")}
            {known ? ` / ${total.toLocaleString("ja-JP")}` : ""} 件
          </span>
        </span>
        {known && <span className="text-ink-soft tabular-nums">{pct}%</span>}
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-soft"
        role="progressbar"
        aria-label="配信の進捗"
        aria-valuemin={0}
        aria-valuemax={known ? total : undefined}
        aria-valuenow={known ? sent : undefined}
        aria-valuetext={known ? `${total}件中${sent}件送信済み` : `${sent}件送信済み`}
      >
        <div
          className={`h-full rounded-full bg-brand transition-all duration-300 ${
            known ? "" : "animate-pulse w-1/3"
          }`}
          style={known ? { width: `${pct}%` } : undefined}
        />
      </div>

      <p className="text-xs text-ink-soft tabular-nums">
        {known && !done && `残り ${remaining.toLocaleString("ja-JP")} 件`}
        {known && done && remaining > 0 && `未送信 ${remaining.toLocaleString("ja-JP")} 件`}
        {failedCount > 0 && `${known ? " / " : ""}失敗 ${failedCount.toLocaleString("ja-JP")} 件`}
      </p>
    </div>
  );
}
