/**
 * Payment/Contract status normalization.
 *
 * Stripe や DB が持つ生のステータスを、UIで扱う 4 分類へ正規化する。
 *
 *   - ok          : 正常
 *   - failed      : 決済失敗
 *   - stopped     : 停止
 *   - in_progress : 手続き中
 *
 * 支援追加・変更・停止の途中状態や、Stripe 連携同期待ちも
 * まとめて `in_progress` に寄せることで、会員向け画面では常に
 * この 4 分類のみを表示する。
 */

import type { ContractStatus } from "@/types/db";

export type PaymentDisplayKey = "ok" | "failed" | "stopped" | "in_progress";

export type PaymentDisplay = {
  key: PaymentDisplayKey;
  label: string;
  description: string;
  chipClass: string;
};

const DISPLAY: Record<PaymentDisplayKey, PaymentDisplay> = {
  ok: {
    key: "ok",
    label: "正常",
    description: "正常にお支払いが継続されています。",
    chipClass: "chip-ok",
  },
  failed: {
    key: "failed",
    label: "決済失敗",
    description: "お支払いが完了していません。ご確認をお願いします。",
    chipClass: "chip-error",
  },
  stopped: {
    key: "stopped",
    label: "停止",
    description: "現在、継続中のご契約はありません。",
    chipClass: "chip-mute",
  },
  in_progress: {
    key: "in_progress",
    label: "手続き中",
    description: "現在、お手続き中です。反映まで少々お待ちください。",
    chipClass: "chip-warn",
  },
};

/**
 * Stripe の subscription.status を UI 4 分類に落とす。
 */
export function fromStripeSubscriptionStatus(
  status: string | null | undefined,
): PaymentDisplayKey {
  switch (status) {
    case "active":
      return "ok";
    case "past_due":
    case "unpaid":
      return "failed";
    case "canceled":
      return "stopped";
    case "incomplete":
    case "incomplete_expired":
    case "trialing":
    case "paused":
    default:
      return "in_progress";
  }
}

/**
 * DB の contracts.status を UI 4 分類に落とす。
 * `null` のとき＝契約そのものが存在しない扱いとして "stopped" を返す。
 */
export function fromContractStatus(
  status: ContractStatus | null | undefined,
): PaymentDisplayKey {
  if (!status) return "stopped";
  switch (status) {
    case "active":
      return "ok";
    case "past_due":
      return "failed";
    case "canceled":
      return "stopped";
    case "paused":
    case "incomplete":
    default:
      return "in_progress";
  }
}

/**
 * マイページ全体の表示状態を決めるためのまとめ関数。
 *
 * 「最後に決済失敗し、その後に成功した」ケースを救済するため、
 * 直近の payments レコードの status も加味してよい。Caller 側で
 * `recentlyRecovered=true` を渡すと、UI 側で補助メッセージを
 * 出すのに使う。
 */
export function describePaymentDisplay(
  key: PaymentDisplayKey,
  opts?: { recentlyRecovered?: boolean; scheduledCancelAt?: string | null },
): PaymentDisplay & {
  bannerMessage: string | null;
} {
  const base = DISPLAY[key];
  let bannerMessage: string | null = null;

  if (key === "ok" && opts?.recentlyRecovered) {
    bannerMessage =
      "直近のお支払いは正常に完了しました。引き続きご利用いただけます。";
  }
  if (opts?.scheduledCancelAt) {
    const d = new Date(opts.scheduledCancelAt);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      bannerMessage = `${y}/${m}/${day} をもって停止予定です。次回更新日までご利用いただけます。`;
    }
  }

  return { ...base, bannerMessage };
}

export const PAYMENT_DISPLAY_LABELS = {
  ok: DISPLAY.ok.label,
  failed: DISPLAY.failed.label,
  stopped: DISPLAY.stopped.label,
  in_progress: DISPLAY.in_progress.label,
} as const;
