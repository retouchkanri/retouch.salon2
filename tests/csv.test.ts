import { test } from "node:test";
import assert from "node:assert/strict";
import { csvToObjects, parseCsv, toCsv } from "../src/lib/csv";

test("toCsv: simple round-trip", () => {
  const rows = [
    { id: "1", name: "Alice", note: "" },
    { id: "2", name: "Bob", note: "OK" },
  ];
  const csv = toCsv(rows, ["id", "name", "note"]);
  assert.equal(csv, "id,name,note\n1,Alice,\n2,Bob,OK");
  const parsed = csvToObjects(csv);
  assert.deepEqual(parsed, [
    { id: "1", name: "Alice", note: "" },
    { id: "2", name: "Bob", note: "OK" },
  ]);
});

test("toCsv: escapes commas, newlines, and quotes", () => {
  const rows = [{ a: 'He said "hi"', b: "line1\nline2", c: "x,y" }];
  const csv = toCsv(rows, ["a", "b", "c"]);
  assert.equal(csv, 'a,b,c\n"He said ""hi""","line1\nline2","x,y"');
  const back = csvToObjects(csv);
  assert.deepEqual(back, [{ a: 'He said "hi"', b: "line1\nline2", c: "x,y" }]);
});

test("toCsv: nullish values become empty string", () => {
  const csv = toCsv([{ a: null, b: undefined, c: 0 }], ["a", "b", "c"]);
  assert.equal(csv, "a,b,c\n,,0");
});

test("parseCsv: ignores empty trailing rows", () => {
  const rows = parseCsv("h1,h2\n1,2\n\n3,4\n");
  assert.deepEqual(rows, [
    ["h1", "h2"],
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("csvToObjects: trims headers and cells", () => {
  const out = csvToObjects(" name , email \n Alice , a@b.c ");
  assert.deepEqual(out, [{ name: "Alice", email: "a@b.c" }]);
});

test("csvToObjects: empty input returns empty array", () => {
  assert.deepEqual(csvToObjects(""), []);
});
