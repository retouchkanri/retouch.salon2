/**
 * 57〜60番の緊急支援募集を終了し、通常表示に戻す（2026-09-21）。
 *
 * やること:
 *   - 57〜60番の is_emergency_recruitment を false にする
 *     → ピンク表示・最上段固定が解除され、通常の馬と同じ並び（支援口数順）になる
 *
 * やらないこと:
 *   - 61・62番には触れない（掲載中のため）
 *   - 画像(image_url)・並び順(sort_order)は変更しない
 *   - 支援受付(is_supportable)は変更しない
 *     ※「支援する」ボタンを消す場合は別途ご指示ください。緊急募集の解除とは別の設定です。
 *
 * 安全対策:
 *   - 実行前の値を backups/ にJSONで保存する（元に戻せるように）
 *   - 対象は名前が 57〜60 で始まるレコードに限定し、4件でなければ中止
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

const { data: all, error } = await sb
  .from("horses")
  .select("id, name, is_emergency_recruitment, is_supportable, image_url, sort_order")
  .order("sort_order");
if (error) {
  console.error("馬マスタの取得に失敗:", error.message);
  process.exit(1);
}

// 名前が「57」「58」「59」「60」で始まる馬だけを対象にする（61・62は除外）。
const targets = all.filter((h) => /^\s*(57|58|59|60)\s*[:：]/.test(h.name));
console.log("対象候補:");
for (const h of targets) {
  console.log(
    `  ${JSON.stringify(h.name)} 緊急=${h.is_emergency_recruitment} 画像=${h.image_url ? "あり" : "なし"} 並び順=${h.sort_order} 支援可=${h.is_supportable}`,
  );
}
if (targets.length !== 4) {
  console.error(`\n中止: 57〜60番として4件見つかるはずが ${targets.length} 件でした。手動で確認してください。`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.resolve(__dirname, `../backups/horses_57_60_${stamp}.json`);
fs.mkdirSync(path.dirname(backupPath), { recursive: true });
fs.writeFileSync(backupPath, JSON.stringify(targets, null, 2), "utf8");
console.log(`\n実行前の値を保存しました → ${backupPath}`);

if (DRY) {
  console.log("\n--dry のため変更しませんでした。");
} else {
  for (const h of targets) {
    const { error: upErr } = await sb
      .from("horses")
      .update({ is_emergency_recruitment: false })
      .eq("id", h.id);
    if (upErr) {
      console.error(`  ! 更新失敗 ${h.name}: ${upErr.message}`);
      process.exit(1);
    }
    console.log(`  更新: ${h.name} → 緊急募集=false（通常表示）`);
  }
}

const { data: after } = await sb
  .from("horses")
  .select("name, is_emergency_recruitment, is_supportable, image_url, sort_order")
  .eq("is_emergency_recruitment", true)
  .order("sort_order");
console.log("\n=== 現在ピンク表示（緊急募集）になっている馬 ===");
if (!after || after.length === 0) {
  console.log("  なし");
} else {
  for (const h of after) {
    console.log(
      `  並び順${String(h.sort_order).padStart(3)} | ${JSON.stringify(h.name)} | 画像=${h.image_url ? "あり" : "なし"} | 支援可=${h.is_supportable}`,
    );
  }
}
