/**
 * 会員メッセージの配信を「残数が0になるまで」自動的に繰り返し呼び出すクライアント用ヘルパー。
 *
 * サーバ側（sendMemberMessage）は Vercel の実行時間上限があるため 1 回の呼び出しでは
 * 全件を送り切れないことがある。以前は管理者が「配信を続ける」を都度クリックする必要が
 * あったが、これを自動化し「一斉送信」を件数無制限・1クリックで完了できるようにする。
 */

export type SendProgress = {
  sentCount: number;
  remaining: number;
  recipientCount: number;
  status: string;
  round: number;
};

export type SendLoopResult = {
  ok: boolean;
  finished: boolean;
  /** サーバがメール基盤側の障害（レート制限・認証失敗等）を検知して配信を一時停止した。 */
  throttled?: boolean;
  /** 一時停止の理由（SMTPエラー文言など）。 */
  throttleReason?: string;
  error?: string;
  progress: SendProgress;
};

/** 無限ループ・過剰リクエストを防ぐための保険的な上限（十分大きい値）。 */
const MAX_ROUNDS = 2000;
/** 一時的な通信エラーで即座に諦めないための連続リトライ上限。 */
const MAX_CONSECUTIVE_ERRORS = 3;

export async function sendMemberMessageUntilDone(
  id: string,
  onProgress?: (progress: SendProgress) => void,
): Promise<SendLoopResult> {
  let round = 0;
  let consecutiveErrors = 0;
  let last: SendProgress = { sentCount: 0, remaining: 0, recipientCount: 0, status: "sending", round: 0 };

  while (round < MAX_ROUNDS) {
    round++;
    let res: Response;
    try {
      res = await fetch(`/api/admin/member-messages/${id}/send`, { method: "POST" });
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return { ok: false, finished: false, error: "通信エラーが発生しました。", progress: last };
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * consecutiveErrors));
      continue;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, finished: false, error: j.error ?? "配信に失敗しました。", progress: last };
    }
    consecutiveErrors = 0;
    const r = j.result ?? {};
    last = {
      sentCount: r.sentCount ?? 0,
      remaining: r.remaining ?? 0,
      recipientCount: r.recipientCount ?? 0,
      status: r.status ?? "sending",
      round,
    };
    onProgress?.(last);

    if (r.throttled) {
      // サーバ側がレート制限等を検知して中断した。ここで呼び出しを重ねると
      // ログイン試行が積み上がり制限が長引くため、ループを止めて cron に委ねる。
      return { ok: true, finished: false, throttled: true, throttleReason: r.throttleReason, progress: last };
    }
    if ((r.remaining ?? 0) <= 0) {
      return { ok: true, finished: true, progress: last };
    }
    // 次の呼び出しの前に少し間隔を空け、外部メールサービスへの負荷やレート制限を避ける。
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { ok: true, finished: false, progress: last };
}
