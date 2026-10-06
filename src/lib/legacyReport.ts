/**
 * システム開始前（令和5年11月〜令和8年6月）の収支まとめ（I/O なし）。
 *
 * 数字は、会員向けに公開済みの次の資料から写したもの。ここでは作り直さない。
 *   - 「Retouch売上確認表」（設立以来の月ごとの収入）
 *   - 「収支報告【前期】令和8年1月〜6月」（令和8年7月1日作成）
 * 令和8年7月以降は monthlyReport.ts の集計を使う。
 */
import { SYSTEM_START_YM, monthLabel, parseYearMonth } from "@/lib/monthlyReport";

export const LEGACY_START_YM = "2023-11";
export const LEGACY_END_YM = "2026-06";

/** duesYen は「①会費収入」、depositYen は「②入金収入（寄付支援・YouTube収益・馬の売却収益を含む）」。 */
export type LegacyMonth = { ym: string; duesYen: number; depositYen: number };

export const LEGACY_MONTHS: readonly LegacyMonth[] = [
  { ym: "2023-11", duesYen: 232_680, depositYen: 55_000 },
  { ym: "2023-12", duesYen: 291_101, depositYen: 25_400 },
  { ym: "2024-01", duesYen: 251_077, depositYen: 5_400 },
  { ym: "2024-02", duesYen: 282_099, depositYen: 5_400 },
  { ym: "2024-03", duesYen: 247_419, depositYen: 3_600 },
  { ym: "2024-04", duesYen: 277_053, depositYen: 3_600 },
  { ym: "2024-05", duesYen: 171_272, depositYen: 9_000 },
  { ym: "2024-06", duesYen: 296_761, depositYen: 3_600 },
  { ym: "2024-07", duesYen: 449_983, depositYen: 5_400 },
  { ym: "2024-08", duesYen: 383_696, depositYen: 356_200 },
  { ym: "2024-09", duesYen: 480_588, depositYen: 183_400 },
  { ym: "2024-10", duesYen: 499_674, depositYen: 370_733 },
  { ym: "2024-11", duesYen: 234_590, depositYen: 774_400 },
  { ym: "2024-12", duesYen: 433_823, depositYen: 273_200 },
  { ym: "2025-01", duesYen: 443_486, depositYen: 66_400 },
  { ym: "2025-02", duesYen: 358_466, depositYen: 126_400 },
  { ym: "2025-03", duesYen: 512_429, depositYen: 252_400 },
  { ym: "2025-04", duesYen: 510_819, depositYen: 1_387_400 },
  { ym: "2025-05", duesYen: 744_945, depositYen: 3_050_400 },
  { ym: "2025-06", duesYen: 1_382_329, depositYen: 1_345_400 },
  { ym: "2025-07", duesYen: 1_183_005, depositYen: 1_384_900 },
  { ym: "2025-08", duesYen: 2_116_525, depositYen: 1_276_900 },
  { ym: "2025-09", duesYen: 2_186_283, depositYen: 464_839 },
  { ym: "2025-10", duesYen: 2_325_709, depositYen: 1_557_600 },
  { ym: "2025-11", duesYen: 2_365_743, depositYen: 4_218_400 },
  { ym: "2025-12", duesYen: 2_765_890, depositYen: 4_951_288 },
  { ym: "2026-01", duesYen: 2_798_745, depositYen: 1_281_944 },
  { ym: "2026-02", duesYen: 2_847_150, depositYen: 3_100_329 },
  { ym: "2026-03", duesYen: 2_890_145, depositYen: 5_546_125 },
  { ym: "2026-04", duesYen: 3_195_513, depositYen: 9_559_202 },
  { ym: "2026-05", duesYen: 3_629_714, depositYen: 2_324_661 },
  { ym: "2026-06", duesYen: 3_316_605, depositYen: 4_110_727 },
];

export const HALF_INCOME_FIELDS = [
  { key: "transferYen", label: "振込寄付" },
  { key: "googleYen", label: "Google収入（YouTube）" },
  { key: "duesYen", label: "会費・支援金" },
  { key: "horseSaleYen", label: "馬の販売" },
] as const;

export const HALF_EXPENSE_FIELDS = [
  { key: "horsePurchaseYen", label: "馬購入費" },
  { key: "horseCareYen", label: "馬管理費" },
  { key: "ponyCareYen", label: "リタポ管理費" },
  { key: "officeYen", label: "事務・運営費" },
] as const;

type HalfIncomeKey = (typeof HALF_INCOME_FIELDS)[number]["key"];
type HalfExpenseKey = (typeof HALF_EXPENSE_FIELDS)[number]["key"];
export type HalfIncomeRow = { ym: string } & Record<HalfIncomeKey, number>;
export type HalfExpenseRow = { ym: string } & Record<HalfExpenseKey, number>;

/** 収支報告【前期】令和8年1月〜6月の収入の部。 */
export const HALF_2026_INCOME: readonly HalfIncomeRow[] = [
  { ym: "2026-01", transferYen: 620_900, googleYen: 661_044, duesYen: 2_798_745, horseSaleYen: 0 },
  { ym: "2026-02", transferYen: 2_797_622, googleYen: 302_707, duesYen: 2_847_150, horseSaleYen: 0 },
  { ym: "2026-03", transferYen: 5_100_371, googleYen: 445_754, duesYen: 2_890_145, horseSaleYen: 0 },
  { ym: "2026-04", transferYen: 7_767_500, googleYen: 911_702, duesYen: 3_195_513, horseSaleYen: 880_000 },
  { ym: "2026-05", transferYen: 1_677_976, googleYen: 646_685, duesYen: 3_629_714, horseSaleYen: 0 },
  { ym: "2026-06", transferYen: 2_763_100, googleYen: 467_627, duesYen: 3_316_605, horseSaleYen: 880_000 },
];

/** 同、支出の部。4〜6月の馬管理費には、ポニーの管理費（月132,000円）を含む。 */
export const HALF_2026_EXPENSES: readonly HalfExpenseRow[] = [
  { ym: "2026-01", horsePurchaseYen: 2_445_000, horseCareYen: 4_257_000, ponyCareYen: 0, officeYen: 888_109 },
  { ym: "2026-02", horsePurchaseYen: 2_445_000, horseCareYen: 4_257_000, ponyCareYen: 0, officeYen: 1_125_044 },
  { ym: "2026-03", horsePurchaseYen: 0, horseCareYen: 4_554_000, ponyCareYen: 0, officeYen: 1_793_149 },
  { ym: "2026-04", horsePurchaseYen: 0, horseCareYen: 4_686_000, ponyCareYen: 0, officeYen: 2_437_529 },
  { ym: "2026-05", horsePurchaseYen: 4_370_000, horseCareYen: 4_587_000, ponyCareYen: 0, officeYen: 1_190_875 },
  { ym: "2026-06", horsePurchaseYen: 0, horseCareYen: 4_587_000, ponyCareYen: 0, officeYen: 1_485_466 },
];

/** 令和7年12月末に株式会社馬事学院から引き継いだ繰越残高。 */
export const HALF_2026_CARRIED_IN_YEN = 1_444_105;

/** 公開済み資料の注記。数字の読み方に必要なものだけを載せる。 */
export const LEGACY_NOTES: readonly string[] = [
  "入金収入には、寄付支援、YouTube収益、馬の売却収益を含みます。",
  "Google収入・会費・支援金は、Google手数料やカード手数料を差し引いた入金額です。",
  "馬の販売は、4月のサニー、6月のピノの売買譲渡代金です。",
  "馬購入費は1頭あたり81.5万円（馬代金71.5万円・輸送経費10万円）、ポニーは1頭27.5万円です。1月は45〜47番目、2月は48〜50番目、5月は51〜53番目とポニー7頭分の購入代金です。",
  "馬管理費は1頭あたり月9.9万円（税込）、ポニーは全頭で月13.2万円（税込）です。去勢代や予防接種などもこの中から出しています。4〜6月の馬管理費には、ポニーの管理費を含みます。",
  "売上の20%を、事務・運営管理費（人件費の一部を含む）としています。",
  "株式会社リタッチは令和7年12月23日に設立し、令和8年1月から、以前の運営会社である株式会社馬事学院より独立して運営しています。前期繰越額は、令和7年12月末に引き継いだ繰越残高です。",
];

export type LegacyMonthRow = LegacyMonth & { label: string; totalYen: number };
export type LegacyYearRow = { year: number; label: string; months: number; duesYen: number; depositYen: number; totalYen: number };

export type LegacySummary = {
  startYm: string;
  endYm: string;
  label: string;
  months: LegacyMonthRow[];
  years: LegacyYearRow[];
  totals: { months: number; duesYen: number; depositYen: number; totalYen: number };
  half: {
    label: string;
    income: (HalfIncomeRow & { label: string; totalYen: number })[];
    incomeTotals: Record<HalfIncomeKey, number> & { totalYen: number };
    expenses: (HalfExpenseRow & { label: string; totalYen: number })[];
    expenseTotals: Record<HalfExpenseKey, number> & { totalYen: number };
    balanceYen: number;
    carriedInYen: number;
    carriedOutYen: number;
  };
  notes: string[];
};

/** 2026-06 → 令和8年6月。令和より前の年はそのまま西暦で返す。 */
export function eraMonthLabel(ym: string): string {
  const parsed = parseYearMonth(ym);
  if (!parsed) return ym;
  if (parsed.year < 2019) return monthLabel(ym);
  return `令和${parsed.year - 2018}年${parsed.month}月`;
}

export function legacyPeriodLabel(): string {
  return `${eraMonthLabel(LEGACY_START_YM)}〜${eraMonthLabel(LEGACY_END_YM)}`;
}

/** システム開始前の月か。経営管理の月次集計は SYSTEM_START_YM から。 */
export function isLegacyMonth(ym: string): boolean {
  return ym < SYSTEM_START_YM;
}

function sumOf<Row, Key extends keyof Row>(rows: readonly Row[], key: Key): number {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

export function buildLegacySummary(): LegacySummary {
  const months = LEGACY_MONTHS.map((row) => ({
    ...row,
    label: eraMonthLabel(row.ym),
    totalYen: row.duesYen + row.depositYen,
  }));

  const byYear = new Map<number, { first: number; last: number; row: LegacyYearRow }>();
  for (const row of months) {
    const { year, month } = parseYearMonth(row.ym)!;
    const entry = byYear.get(year) ?? {
      first: month,
      last: month,
      row: { year, label: "", months: 0, duesYen: 0, depositYen: 0, totalYen: 0 },
    };
    entry.last = month;
    entry.row.months += 1;
    entry.row.duesYen += row.duesYen;
    entry.row.depositYen += row.depositYen;
    entry.row.totalYen += row.totalYen;
    byYear.set(year, entry);
  }
  const years = [...byYear.values()].map(({ first, last, row }) => ({
    ...row,
    label: row.months === 12 ? `令和${row.year - 2018}年` : `令和${row.year - 2018}年（${first}〜${last}月）`,
  }));

  const income = HALF_2026_INCOME.map((row) => ({
    ...row,
    label: eraMonthLabel(row.ym),
    totalYen: HALF_INCOME_FIELDS.reduce((sum, field) => sum + row[field.key], 0),
  }));
  const expenses = HALF_2026_EXPENSES.map((row) => ({
    ...row,
    label: eraMonthLabel(row.ym),
    totalYen: HALF_EXPENSE_FIELDS.reduce((sum, field) => sum + row[field.key], 0),
  }));
  const incomeTotals = {
    transferYen: sumOf(income, "transferYen"),
    googleYen: sumOf(income, "googleYen"),
    duesYen: sumOf(income, "duesYen"),
    horseSaleYen: sumOf(income, "horseSaleYen"),
    totalYen: sumOf(income, "totalYen"),
  };
  const expenseTotals = {
    horsePurchaseYen: sumOf(expenses, "horsePurchaseYen"),
    horseCareYen: sumOf(expenses, "horseCareYen"),
    ponyCareYen: sumOf(expenses, "ponyCareYen"),
    officeYen: sumOf(expenses, "officeYen"),
    totalYen: sumOf(expenses, "totalYen"),
  };
  const balanceYen = incomeTotals.totalYen - expenseTotals.totalYen;

  return {
    startYm: LEGACY_START_YM,
    endYm: LEGACY_END_YM,
    label: legacyPeriodLabel(),
    months,
    years,
    totals: {
      months: months.length,
      duesYen: sumOf(months, "duesYen"),
      depositYen: sumOf(months, "depositYen"),
      totalYen: sumOf(months, "totalYen"),
    },
    half: {
      label: `${eraMonthLabel(HALF_2026_INCOME[0].ym)}〜${parseYearMonth(HALF_2026_INCOME[HALF_2026_INCOME.length - 1].ym)!.month}月`,
      income,
      incomeTotals,
      expenses,
      expenseTotals,
      balanceYen,
      carriedInYen: HALF_2026_CARRIED_IN_YEN,
      carriedOutYen: HALF_2026_CARRIED_IN_YEN + balanceYen,
    },
    notes: [...LEGACY_NOTES],
  };
}

/** 保存済みスナップショットが、いまの画面で描ける形かを確かめる。 */
export function asLegacySummary(value: unknown): LegacySummary | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as LegacySummary;
  if (!Array.isArray(summary.months) || !Array.isArray(summary.years)) return null;
  if (!summary.totals || !summary.half || !Array.isArray(summary.half.income) || !Array.isArray(summary.half.expenses)) return null;
  return { ...summary, notes: Array.isArray(summary.notes) ? summary.notes : [] };
}
