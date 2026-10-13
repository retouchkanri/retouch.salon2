import { test } from "node:test";
import assert from "node:assert/strict";
import { csvToObjects, toCsv } from "../src/lib/csv";
import { MEMBERSHIP_COLUMNS, membershipColumns, type CustomerSummaryRow, type SupportDetailRow } from "../src/lib/customerExport";

function summary(partial: Partial<CustomerSummaryRow> = {}): CustomerSummaryRow {
  return {
    customer_id: "u1",
    member_class_code: null,
    primary_plan_name: null,
    rpt_active: false,
    special_team_count: 0,
    special_team_names: null,
    total_support_units: 0,
    ...partial,
  };
}

function support(horseId: string, name: string, units: number, status = "active", order: number | null = null): SupportDetailRow {
  return { customer_id: "u1", horse_id: horseId, units, status, horse: { name, sort_order: order } };
}

test("the member class matches the customer list", () => {
  assert.equal(membershipColumns(summary({ member_class_code: "A", primary_plan_name: "メンバーズ会員" }), []).会員種別, "メンバーズ会員");
  // アテンダー会員はコード A を使うので、プラン名で出す。
  assert.equal(membershipColumns(summary({ member_class_code: "A", primary_plan_name: "アテンダー会員" }), []).会員種別, "アテンダー会員");
  // 一口支援だけの人
  assert.equal(membershipColumns(summary({ member_class_code: "SUPPORT", total_support_units: 1 }), []).会員種別, "ヘルパーズ会員");
  // どれにも入っていない人
  assert.equal(membershipColumns(summary(), []).会員種別, "無料会員");
  // リタポ・特別チームだけの人は、顧客一覧と同じく会員種別は「—」
  assert.equal(membershipColumns(summary({ rpt_active: true }), []).会員種別, "—");
  assert.equal(membershipColumns(summary({ special_team_count: 1, special_team_names: ["ガンガン支援チーム"] }), []).会員種別, "—");
});

test("special participation lists リタポ and each special team", () => {
  assert.equal(membershipColumns(summary(), []).特別参加, "");
  assert.equal(membershipColumns(summary({ rpt_active: true }), []).特別参加, "リタポメンバー");
  assert.equal(
    membershipColumns(summary({ rpt_active: true, special_team_count: 2, special_team_names: ["ガンガン支援チーム", "58：親子"] }), []).特別参加,
    "リタポメンバー、特別チーム：ガンガン支援チーム、特別チーム：58：親子",
  );
  // チーム名が取れないときも、参加していることは出す。
  assert.equal(membershipColumns(summary({ special_team_count: 1, special_team_names: null }), []).特別参加, "特別チーム会員");
});

test("support shows the total units and which horse gets how many", () => {
  const columns = membershipColumns(summary({ member_class_code: "SUPPORT", total_support_units: "2.5" }), [
    support("h2", "15：ヒメ（大阪）", 0.5, "active", 15),
    support("h1", "05：ハオ（千葉：山武）", 1, "active", 5),
    // 同じ馬への支援が 2 行に分かれているときは、1 つにまとめる。
    support("h1", "05：ハオ（千葉：山武）", 1, "active", 5),
  ]);
  assert.equal(columns.支援口数, 2.5);
  assert.equal(columns.支援先と口数, "05：ハオ（千葉：山武）に2口、15：ヒメ（大阪）に0.5口");
});

test("a customer without support has blank support columns", () => {
  const columns = membershipColumns(summary({ member_class_code: "A", primary_plan_name: "メンバーズ会員" }), []);
  assert.equal(columns.支援口数, "");
  assert.equal(columns.支援先と口数, "");
});

test("support whose payment is failing is shown with a note and left out of the total", () => {
  const columns = membershipColumns(summary({ total_support_units: 0 }), [
    support("h1", "ミント", 1, "past_due"),
    support("h2", "カエデ", 0.5, "canceled"),
  ]);
  assert.equal(columns.支援口数, "");
  assert.equal(columns.支援先と口数, "ミントに1口（決済失敗中）");
});

test("a customer missing from the summary gets blanks, and a missing horse is still listed", () => {
  assert.deepEqual(membershipColumns(undefined, []), { 会員種別: "", 特別参加: "", 支援口数: "", 支援先と口数: "" });
  const lost: SupportDetailRow = { customer_id: "u1", horse_id: "gone", units: 1, status: "active", horse: null };
  assert.equal(membershipColumns(summary({ total_support_units: 1 }), [lost]).支援先と口数, "（馬の登録なし）に1口");
});

test("an exported file can be read back for import with the original columns unchanged", () => {
  const exported = [
    { id: "u1", full_name: "山田 太郎", email: "a@x.jp", status: "active", ...membershipColumns(summary({ rpt_active: true, total_support_units: 1.5 }), [support("h1", "53🔴【10口】：ハジメ（千葉）", 1.5)]) },
  ];
  const csv = toCsv(exported, ["id", "full_name", "email", "status", ...MEMBERSHIP_COLUMNS]);
  assert.equal(csv.split("\n")[0], "id,full_name,email,status,会員種別,特別参加,支援口数,支援先と口数");
  const [row] = csvToObjects(csv);
  // 取込が読むのは英字の列だけ。値はそのまま戻る。
  assert.deepEqual({ id: row.id, full_name: row.full_name, email: row.email, status: row.status }, { id: "u1", full_name: "山田 太郎", email: "a@x.jp", status: "active" });
  assert.equal(row["支援先と口数"], "53🔴【10口】：ハジメ（千葉）に1.5口");
});
