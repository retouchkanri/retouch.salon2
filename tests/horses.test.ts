import { test } from "node:test";
import assert from "node:assert/strict";
import { compareHorsesForDisplay, isRecruitmentSlot } from "../src/lib/horses";

test("rows that are only a new-recruitment slot are recognised by their name", () => {
  assert.equal(isRecruitmentSlot({ name: "59：緊急支援募集馬" }), true);
  assert.equal(isRecruitmentSlot({ name: "60：緊急支援募集馬" }), true);
  // 実際の馬の行は、名前に「緊急支援」とあっても枠ではない。
  assert.equal(isRecruitmentSlot({ name: "【緊急支援】61番目／現4名（3.5口）" }), false);
  assert.equal(isRecruitmentSlot({ name: "63🔴【8口】名前募集（大阪）" }), false);
  assert.equal(isRecruitmentSlot({ name: "60：お名前選定中" }), false);
  assert.equal(isRecruitmentSlot({ name: "59：親子（オーナー決定）" }), false);
});

test("every horse is ordered the same way: most support first, then the master order", () => {
  const units: Record<string, number> = { a: 5, b: 9, c: 5, d: 0, e: 0 };
  const horses = [
    // 以前は緊急募集として最上段に固定されていた馬（並び順がマイナス）。いまは口数で並ぶ。
    { id: "a", sort_order: -3 },
    { id: "b", sort_order: 25 },
    { id: "c", sort_order: 60 },
    { id: "d", sort_order: 113 },
    { id: "e", sort_order: -6 },
  ];
  const sorted = [...horses].sort((x, y) => compareHorsesForDisplay(x, y, (id) => units[id] ?? 0));
  assert.deepEqual(sorted.map((horse) => horse.id), ["b", "a", "c", "e", "d"]);
});
