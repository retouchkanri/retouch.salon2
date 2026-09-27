/**
 * 61・62番を「緊急支援募集」として掲載する（2026-09-21）。
 *
 * やること:
 *   - 61・62番の is_emergency_recruitment を true にする
 *     → トップ／馬一覧でピンク表示・最上段に固定される
 *   - 61・62番の image_url を null にする（写真がまだ無いため）
 *     → EmergencyHorseImage がピンク枠の「準備中」表示になる
 *
 * やらないこと:
 *   - 57〜60番には一切触れない（現状維持のご指示のため）
 *   - 馬の新規作成はしない（管理画面で作成済みのレコードを更新するだけ）
 *   - 並び順(sort_order)は変更しない
 *
 * 安全対策:
 *   - 実行前の値を backups/ にJSONで保存する（元に戻せるように）
 *   - 対象は名前が「61」「62」で始まるレコードに限定し、2件でなければ中止
 *   - 冪等（何度実行しても同じ結果）
 *   - `--dry` で変更せずに確認だけ行う
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// 対象の特定。管理画面で登録された名前は「【緊急募集】61番目」「【緊急募集】62番目」。
// 表記ゆれに備えて「61」「62」を含む馬を拾い、57〜60 は明示的に除外する。
const { data: all, error } = await sb
  .from("horses")
  .select("id, name, is_emergency_recruitment, is_supportable, image_url, sort_order")
  .order("sort_order");
if (error) {
  console.error("馬マスタの取得に失敗:", error.message);
  process.exit(1);
}

const targets = all.filter((h) => /(^|[^0-9])(61|62)([^0-9]|$)/.test(h.name));
console.log("対象候補:");
for (const h of targets) {
  console.log(
    `  ${JSON.stringify(h.name)} 緊急=${h.is_emergency_recruitment} 画像=${h.image_url ? "あり" : "なし"} 並び順=${h.sort_order}`,
  );
}
if (targets.length !== 2) {
  console.error(`\n中止: 61・62番として2件見つかるはずが ${targets.length} 件でした。手動で確認してください。`);
  process.exit(1);
}

// 実行前の値をバックアップ（元に戻せるようにする）
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.resolve(__dirname, `../backups/horses_61_62_${stamp}.json`);
fs.mkdirSync(path.dirname(backupPath), { recursive: true });
fs.writeFileSync(backupPath, JSON.stringify(targets, null, 2), "utf8");
console.log(`\n実行前の値を保存しました → ${backupPath}`);

if (DRY) {
  console.log("\n--dry のため変更しませんでした。");
  process.exit(0);
}

for (const h of targets) {
  const { error: upErr } = await sb
    .from("horses")
    .update({ is_emergency_recruitment: true, image_url: null })
    .eq("id", h.id);
  if (upErr) {
    console.error(`  ! 更新失敗 ${h.name}: ${upErr.message}`);
    process.exit(1);
  }
  console.log(`  更新: ${h.name} → 緊急募集=true / 画像=なし（準備中表示）`);
}

// 結果確認。57〜60 が変わっていないことも併せて表示する。
const { data: after } = await sb
  .from("horses")
  .select("name, is_emergency_recruitment, is_supportable, image_url, sort_order")
  .or("is_emergency_recruitment.eq.true,name.ilike.%緊急%")
  .order("sort_order");
console.log("\n=== 実行後の緊急募集馬 ===");
for (const h of after ?? []) {
  console.log(
    `  並び順${String(h.sort_order).padStart(3)} | ${JSON.stringify(h.name)} | 緊急=${h.is_emergency_recruitment} | 画像=${h.image_url ? "あり" : "なし"} | 支援可=${h.is_supportable}`,
  );
}
