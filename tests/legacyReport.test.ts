import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_END_YM,
  LEGACY_MONTHS,
  LEGACY_START_YM,
  asLegacySummary,
  buildLegacySummary,
  eraMonthLabel,
  isLegacyMonth,
  legacyPeriodLabel,
} from "../src/lib/legacyReport";
import { SYSTEM_START_YM, formatYearMonth, parseYearMonth, shiftMonth } from "../src/lib/monthlyReport";

// 「Retouch売上確認表」3ページ目の「①＋②合算合計」。会費と入金を別々に写した数字の検算に使う。
const PUBLISHED_TOTALS = [
  287_680, 316_501, 256_477, 287_499, 251_019, 280_653, 180_272, 300_361, 455_383, 739_896, 663_988, 870_407,
  1_008_990, 707_023, 509_886, 484_866, 764_829, 1_898_219, 3_795_345, 2_727_729, 2_567_905, 3_393_425, 2_651_122,
  3_883_309, 6_584_143, 7_717_178, 4_080_689, 5_947_479, 8_436_270, 12_754_715, 5_954_375, 7_427_332,
];

test("legacy months run from Reiwa 5 November to Reiwa 8 June without a gap", () => {
  assert.equal(LEGACY_MONTHS.length, 32);
  assert.equal(LEGACY_MONTHS[0].ym, LEGACY_START_YM);
  assert.equal(LEGACY_MONTHS[LEGACY_MONTHS.length - 1].ym, LEGACY_END_YM);
  LEGACY_MONTHS.forEach((row, index) => {
    const start = parseYearMonth(LEGACY_START_YM)!;
    const expected = shiftMonth(start.year, start.month, index);
    assert.equal(row.ym, formatYearMonth(expected.year, expected.month));
  });
  const end = parseYearMonth(LEGACY_END_YM)!;
  const next = shiftMonth(end.year, end.month, 1);
  assert.equal(formatYearMonth(next.year, next.month), SYSTEM_START_YM);
});

test("each month matches the published combined total", () => {
  const summary = buildLegacySummary();
  assert.deepEqual(summary.months.map((row) => row.totalYen), PUBLISHED_TOTALS);
  assert.equal(summary.totals.totalYen, PUBLISHED_TOTALS.reduce((sum, value) => sum + value, 0));
  assert.equal(summary.totals.duesYen + summary.totals.depositYen, summary.totals.totalYen);
  assert.equal(summary.totals.months, 32);
});

test("yearly rows add up to the whole period", () => {
  const { years, totals } = buildLegacySummary();
  assert.deepEqual(years.map((row) => row.label), ["令和5年（11〜12月）", "令和6年", "令和7年", "令和8年（1〜6月）"]);
  assert.deepEqual(years.map((row) => row.months), [2, 12, 12, 6]);
  assert.equal(years.reduce((sum, row) => sum + row.totalYen, 0), totals.totalYen);
  assert.equal(years[0].totalYen, 287_680 + 316_501);
});

test("Reiwa 8 first half matches the published income and expenditure report", () => {
  const { half, months } = buildLegacySummary();
  assert.equal(half.label, "令和8年1月〜6月");
  assert.equal(half.incomeTotals.transferYen, 20_727_469);
  assert.equal(half.incomeTotals.googleYen, 3_435_519);
  assert.equal(half.incomeTotals.duesYen, 18_677_872);
  assert.equal(half.incomeTotals.horseSaleYen, 1_760_000);
  assert.equal(half.incomeTotals.totalYen, 44_600_860);
  assert.deepEqual(half.income.map((row) => row.totalYen), PUBLISHED_TOTALS.slice(-6));
  assert.equal(half.expenseTotals.horsePurchaseYen, 9_260_000);
  assert.equal(half.expenseTotals.horseCareYen, 26_928_000);
  assert.equal(half.expenseTotals.ponyCareYen, 0);
  assert.equal(half.expenseTotals.officeYen, 8_920_172);
  assert.equal(half.expenseTotals.totalYen, 45_108_172);
  assert.deepEqual(half.expenses.map((row) => row.totalYen), [7_590_109, 7_827_044, 6_347_149, 7_123_529, 10_147_875, 6_072_466]);
  assert.equal(half.balanceYen, -507_312);
  assert.equal(half.carriedInYen, 1_444_105);
  assert.equal(half.carriedOutYen, 936_793);
  // 売上確認表と収支報告書は同じ月を別の切り口で載せている。会費と、それ以外の入金が一致すること。
  half.income.forEach((row) => {
    const month = months.find((item) => item.ym === row.ym)!;
    assert.equal(month.duesYen, row.duesYen);
    assert.equal(month.depositYen, row.transferYen + row.googleYen + row.horseSaleYen);
  });
});

test("era labels and the system boundary", () => {
  assert.equal(eraMonthLabel("2023-11"), "令和5年11月");
  assert.equal(eraMonthLabel("2026-06"), "令和8年6月");
  assert.equal(legacyPeriodLabel(), "令和5年11月〜令和8年6月");
  assert.equal(isLegacyMonth("2026-06"), true);
  assert.equal(isLegacyMonth("2026-07"), false);
});

test("a saved summary is read back, and other shapes are rejected", () => {
  const summary = buildLegacySummary();
  assert.deepEqual(asLegacySummary(JSON.parse(JSON.stringify(summary))), summary);
  assert.equal(asLegacySummary(null), null);
  assert.equal(asLegacySummary({ report: { ym: "2026-07" } }), null);
});
