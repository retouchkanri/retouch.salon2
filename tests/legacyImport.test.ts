import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/lib/csv";
import {
  buildHeaderIndex,
  groupByCustomer,
  parseLegacyTable,
  rankToPlan,
} from "../src/lib/legacy-import";

test("buildHeaderIndex: maps Japanese aliases to canonical keys", () => {
  const idx = buildHeaderIndex([
    "契約日",
    "馬名",
    "口数",
    "状態",
    "氏名",
    "メールアドレス",
    "郵便番号",
    "住所",
    "ランク",
  ]);
  assert.equal(idx.contractDate, 0);
  assert.equal(idx.horseName, 1);
  assert.equal(idx.units, 2);
  assert.equal(idx.status, 3);
  assert.equal(idx.fullName, 4);
  assert.equal(idx.email, 5);
  assert.equal(idx.postalCode, 6);
  assert.equal(idx.address, 7);
  assert.equal(idx.rank, 8);
});

test("buildHeaderIndex: accepts English headers too", () => {
  const idx = buildHeaderIndex(["full_name", "email", "horse_name", "units"]);
  assert.equal(idx.fullName, 0);
  assert.equal(idx.email, 1);
  assert.equal(idx.horseName, 2);
  assert.equal(idx.units, 3);
});

test("rankToPlan: standard membership ranks", () => {
  assert.deepEqual(rankToPlan("メンバーズ"), { code: "B", name: "B会員" });
  assert.deepEqual(rankToPlan("アテンダー会員"), { code: "A", name: "A会員" });
  assert.deepEqual(rankToPlan("オーナーズ"), { code: "OWNER", name: "オーナーズ会員" });
  assert.deepEqual(rankToPlan("リェリーフ"), { code: "C", name: "リェリーフ会員" });
  assert.deepEqual(rankToPlan("特別チーム"), {
    code: "SPECIAL_TEAM",
    name: "特別チーム会員",
  });
  assert.deepEqual(rankToPlan("1口支援"), { code: "SUPPORT", name: "1口支援" });
  assert.deepEqual(rankToPlan("半口支援"), {
    code: "SUPPORT",
    name: "半口支援",
  });
  assert.equal(rankToPlan("無料会員"), null);
  assert.equal(rankToPlan(null), null);
  assert.equal(rankToPlan(""), null);
});

test("parseLegacyTable: tolerates BOM, Japanese dates, 半口 unit text", () => {
  const csv =
    "契約日,馬名,口数,状態,氏名,メール,ランク\n" +
    "2024年4月1日,ハーモニー,半口,継続中,山田太郎,taro@example.com,半口支援\n" +
    "2024/05/02,スター,2,休止,佐藤花子,hanako@example.com,メンバーズ\n";
  const table = parseCsv(csv);
  const { rows, headerWarnings } = parseLegacyTable(table);
  assert.deepEqual(headerWarnings, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].contractDate, "2024-04-01");
  assert.equal(rows[0].units, 0.5);
  assert.equal(rows[0].email, "taro@example.com");
  assert.equal(rows[1].contractDate, "2024-05-02");
  assert.equal(rows[1].units, 2);
});

test("parseLegacyTable: flags missing required headers", () => {
  const table = parseCsv("契約日,口数\n2024-01-01,1\n");
  const { headerWarnings } = parseLegacyTable(table);
  assert.equal(headerWarnings.length, 1);
  assert.ok(headerWarnings[0].includes("氏名"));
});

test("groupByCustomer: groups multi-row legacy customers by email", () => {
  const csv =
    "氏名,メール,馬名,口数,ランク,契約日,郵便番号,住所\n" +
    "山田太郎,taro@example.com,ハーモニー,1,1口支援,2024-04-01,100-0001,東京都千代田区A\n" +
    "山田太郎,taro@example.com,スター,0.5,1口支援,2024-06-10,100-0001,東京都千代田区A\n" +
    "佐藤花子,hanako@example.com,,,メンバーズ,2024-01-15,200-0002,横浜市B\n";
  const { rows } = parseLegacyTable(parseCsv(csv));
  const { customers, dropped } = groupByCustomer(rows);
  assert.equal(dropped.length, 0);
  assert.equal(customers.length, 2);

  const taro = customers.find((c) => c.email === "taro@example.com")!;
  assert.equal(taro.fullName, "山田太郎");
  assert.equal(taro.supports.length, 2);
  assert.equal(taro.supports[0].units, 1);
  assert.equal(taro.supports[1].units, 0.5);
  assert.equal(taro.contractStartedAt, "2024-04-01");
  assert.deepEqual(taro.plan, { code: "SUPPORT", name: "1口支援" });

  const hanako = customers.find((c) => c.email === "hanako@example.com")!;
  assert.equal(hanako.supports.length, 0);
  assert.deepEqual(hanako.plan, { code: "B", name: "B会員" });
});

test("groupByCustomer: drops rows with no email and reports them", () => {
  const csv =
    "氏名,メール,馬名,口数\n" + "no email,,ハーモニー,1\n" + "ok,a@b.co,スター,2\n";
  const { rows } = parseLegacyTable(parseCsv(csv));
  const { customers, dropped } = groupByCustomer(rows);
  assert.equal(customers.length, 1);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].row.fullName, "no email");
});

test("groupByCustomer: status mapping handles 退会 / 休止 labels", () => {
  const csv =
    "氏名,メール,状態\n" +
    "退会済み,gone@x.co,退会\n" +
    "休止中,pause@x.co,休止\n" +
    "現役,active@x.co,継続中\n";
  const { rows } = parseLegacyTable(parseCsv(csv));
  const { customers } = groupByCustomer(rows);
  const byEmail = new Map(customers.map((c) => [c.email, c.status]));
  assert.equal(byEmail.get("gone@x.co"), "withdrawn");
  assert.equal(byEmail.get("pause@x.co"), "suspended");
  assert.equal(byEmail.get("active@x.co"), "active");
});
