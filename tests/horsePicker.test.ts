import assert from "node:assert/strict";
import test from "node:test";
import {
  availableSupportUnits,
  compareHorsesByNumber,
  horseCapacityUnits,
  horseOptionLabel,
  horseSerialNumber,
} from "../src/lib/horsePicker";

test("reads the horse number from the name", () => {
  assert.equal(horseSerialNumber("59：緊急支援募集馬"), 59);
  assert.equal(horseSerialNumber("01：パヴォーネ（千葉：山武）"), 1);
  assert.equal(horseSerialNumber("【緊急支援】62番目／現8名（5.5口）"), 62);
  assert.equal(horseSerialNumber("名前だけの馬"), null);
});

test("remaining openings are the capacity minus current units", () => {
  assert.equal(horseCapacityUnits("63🔴【8口】名前募集（大阪）"), 8);
  assert.equal(availableSupportUnits(8, 5.5), 2.5);
  assert.equal(availableSupportUnits(10, 12), 0);
  assert.equal(availableSupportUnits(null, 3), null);
});

test("a number already in the name is not shown twice", () => {
  assert.equal(horseOptionLabel("36 🔵イメル【7口】（千葉）", "応募可能 1口"), "36 🔵イメル【7口】（千葉）　応募可能 1口");
  assert.equal(horseOptionLabel("【緊急支援】62番目／現8名", "募集中"), "【緊急支援】62番目／現8名　募集中");
});

test("horses sort by number", () => {
  const names = ["59：緊急支援募集馬", "01：パヴォーネ", "【緊急支援】62番目／現8名", "名前だけ"];
  const sorted = names
    .map((name, sortOrder) => ({ name, sortOrder }))
    .sort(compareHorsesByNumber)
    .map((horse) => horse.name);
  assert.deepEqual(sorted, ["01：パヴォーネ", "59：緊急支援募集馬", "【緊急支援】62番目／現8名", "名前だけ"]);
});
