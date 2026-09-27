import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatUnits, formatYen, genderLabel, statusLabel } from "../src/lib/format";

test("formatYen: prefixes ¥ and locales", () => {
  assert.equal(formatYen(1234), "¥1,234");
  assert.equal(formatYen(0), "¥0");
  assert.equal(formatYen(null), "—");
  assert.equal(formatYen(undefined), "—");
  assert.equal(formatYen(NaN as any), "—");
});

test("formatDate: handles strings, dates, withTime", () => {
  const iso = "2026-04-23T05:30:00Z";
  // We can't assert the exact local hour cross-platform, so check shape.
  assert.match(formatDate(iso), /^\d{4}\/\d{2}\/\d{2}$/);
  assert.match(formatDate(iso, true), /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate("garbage"), "—");
});

test("formatUnits: integer vs fractional", () => {
  assert.equal(formatUnits(1), "1口");
  assert.equal(formatUnits(0.5), "0.5口");
  assert.equal(formatUnits(2.5), "2.5口");
  assert.equal(formatUnits(null), "—");
});

test("genderLabel covers known + fallback", () => {
  assert.equal(genderLabel("male"), "男性");
  assert.equal(genderLabel("female"), "女性");
  assert.equal(genderLabel("other"), "その他");
  assert.equal(genderLabel("unspecified"), "未指定");
  assert.equal(genderLabel(null), "—");
});

test("statusLabel covers booking, contract, payment values", () => {
  assert.equal(statusLabel("reserved"), "予約中");
  assert.equal(statusLabel("attended"), "参加済");
  assert.equal(statusLabel("no_show"), "不参加");
  assert.equal(statusLabel("canceled"), "停止");
  assert.equal(statusLabel("active"), "正常");
  assert.equal(statusLabel("past_due"), "決済失敗");
  assert.equal(statusLabel("succeeded"), "成功");
  assert.equal(statusLabel("failed"), "失敗");
  assert.equal(statusLabel("unknown"), "unknown");
});
