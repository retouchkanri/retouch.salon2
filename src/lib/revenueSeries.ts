// 収益推移チャート用の集計ロジック（年・月・週・日）。
// すべて日本時間（Asia/Tokyo）でバケットを切り、サーバーのタイムゾーンに依存しない。

export type RevenuePeriod = "day" | "week" | "month" | "year";
export type RevenuePoint = { label: string; total: number; tip: string };
export type RevenueSeries = Record<RevenuePeriod, RevenuePoint[]>;

export type RawPayment = { occurred_at: string; amount: number | string | null };

/** Asia/Tokyo の年月日を数値で取り出す。 */
function jstYMD(d: Date): { y: number; m: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), day: Number(parts.day) };
}

/** JST の暦日を「エポックからの通算日数」に変換（タイムゾーン非依存の整数）。 */
function dayNum(d: Date): number {
  const { y, m, day } = jstYMD(d);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

/** 通算日数から年月日へ戻す。 */
function fromDayNum(n: number): { y: number; m: number; day: number } {
  const d = new Date(n * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * 成功決済の配列から、4 つの粒度（日・週・月・年）の収益推移を組み立てる。
 * - 日:  直近 30 日
 * - 週:  直近 12 週（7 日区切り、本日を含む週まで）
 * - 月:  直近 12 か月
 * - 年:  直近 5 年
 */
export function buildRevenueSeries(payments: RawPayment[], now: Date = new Date()): RevenueSeries {
  // 決済を (JST 通算日, 月キー, 年, 金額) へ正規化。
  const norm = payments.map((p) => {
    const d = new Date(p.occurred_at);
    const { y, m } = jstYMD(d);
    return {
      dn: dayNum(d),
      monthKey: `${y}-${String(m).padStart(2, "0")}`,
      year: y,
      amount: Number(p.amount ?? 0) || 0,
    };
  });

  const today = dayNum(now);
  const { y: curY, m: curM } = jstYMD(now);

  // ── 日（直近 30 日） ──
  const dayTotals = new Map<number, number>();
  for (const p of norm) dayTotals.set(p.dn, (dayTotals.get(p.dn) ?? 0) + p.amount);
  const day: RevenuePoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const n = today - i;
    const { y, m, day: dd } = fromDayNum(n);
    day.push({ label: `${m}/${dd}`, total: dayTotals.get(n) ?? 0, tip: `${y}/${m}/${dd}` });
  }

  // ── 週（直近 12 週） ──
  const weekTotals = new Map<number, number>();
  for (const p of norm) {
    const weeksAgo = Math.floor((today - p.dn) / 7);
    if (weeksAgo >= 0 && weeksAgo <= 11) {
      weekTotals.set(weeksAgo, (weekTotals.get(weeksAgo) ?? 0) + p.amount);
    }
  }
  const week: RevenuePoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const endN = today - i * 7;
    const s = fromDayNum(endN - 6);
    const e = fromDayNum(endN);
    week.push({
      label: `${s.m}/${s.day}`,
      total: weekTotals.get(i) ?? 0,
      tip: `${s.m}/${s.day}〜${e.m}/${e.day}`,
    });
  }

  // ── 月（直近 12 か月） ──
  const monthTotals = new Map<string, number>();
  for (const p of norm) monthTotals.set(p.monthKey, (monthTotals.get(p.monthKey) ?? 0) + p.amount);
  const month: RevenuePoint[] = [];
  for (let i = 11; i >= 0; i--) {
    let mm = curM - i;
    let yy = curY;
    while (mm <= 0) {
      mm += 12;
      yy -= 1;
    }
    const key = `${yy}-${String(mm).padStart(2, "0")}`;
    month.push({ label: `${mm}月`, total: monthTotals.get(key) ?? 0, tip: `${yy}年${mm}月` });
  }

  // ── 年（直近 5 年） ──
  const yearTotals = new Map<number, number>();
  for (const p of norm) yearTotals.set(p.year, (yearTotals.get(p.year) ?? 0) + p.amount);
  const year: RevenuePoint[] = [];
  for (let i = 4; i >= 0; i--) {
    const yy = curY - i;
    year.push({ label: `${yy}`, total: yearTotals.get(yy) ?? 0, tip: `${yy}年` });
  }

  return { day, week, month, year };
}
