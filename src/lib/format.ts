export function formatYen(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

// すべての日付は日本時間（Asia/Tokyo）で表示する。サーバーのタイムゾーン
// （Vercel は UTC）に依存せず、Stripe ダッシュボード（JST）の表示と一致させる。
const JST_DATE = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const JST_DATETIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const parts = Object.fromEntries(
    (withTime ? JST_DATETIME : JST_DATE).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}/${parts.month}/${parts.day}`;
  return withTime ? `${date} ${parts.hour}:${parts.minute}` : date;
}

export function formatUnits(units: number | null | undefined): string {
  if (units == null) return "—";
  const n = Number(units);
  if (Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? `${n}口` : `${n.toFixed(1)}口`;
}

/**
 * 会員種別（基本区分）の表示ラベル。DBのプランコードは A/B/C のまま、
 * 表示のみ大分類に統一する：
 *   A→メンバーズ会員 / B→サポーター会員 / C→リェリーフ会員 /
 *   OWNER→オーナーズ会員 / SUPPORT→ヘルパーズ会員。
 * 口数（半口/1口/1.5口…）は会員種別名に含めず、「支援数／支援口数」で別管理。
 */
export function memberClassLabel(code: string | null | undefined): string {
  switch (code) {
    case "A":
      return "メンバーズ会員";
    case "B":
      return "サポーター会員";
    case "C":
      return "リェリーフ会員";
    case "OWNER":
      return "オーナーズ会員";
    case "SUPPORT":
      // 口数（半口/1口/1.5口…）に関わらず会員種別名は一定。口数は「支援数」で管理。
      return "ヘルパーズ会員";
    case "RPT":
      return "リタポメンバー";
    case "SPECIAL_TEAM":
      return "特別チーム会員";
    default:
      return "—";
  }
}

/** 寄付の支払方法ラベル（既定はカード）。 */
export function donationMethodLabel(method: string | null | undefined): string {
  return method === "bank_transfer" ? "銀行振込" : "カード";
}

export function genderLabel(gender: string | null | undefined): string {
  switch (gender) {
    case "male":
      return "男性";
    case "female":
      return "女性";
    case "other":
      return "その他";
    case "unspecified":
      return "未指定";
    default:
      return "—";
  }
}

export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "正常";
    case "past_due":
      return "決済失敗";
    case "canceled":
      return "停止";
    case "paused":
      return "一時停止";
    case "incomplete":
      return "手続き中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失敗";
    case "pending":
      return "保留";
    case "refunded":
      return "返金済";
    case "reserved":
      return "予約中";
    case "attended":
      return "参加済";
    case "no_show":
      return "不参加";
    case "suspended":
      return "停止中";
    case "withdrawn":
      return "退会済";
    default:
      return status ?? "—";
  }
}
