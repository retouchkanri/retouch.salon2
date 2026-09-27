/**
 * 61・62番のカードから「令和8年9月23日~25日」の一文を削除する（2026-09-21）。
 *
 * やること:
 *   - 61・62番の profile から対象の一文を取り除く
 *     （その一文だけの場合は profile を空(null)にする）
 *
 * やらないこと:
 *   - 他の馬には触れない。同じ「令和8年9月」を含む紹介文が
 *     06：ノア／26：トワ／00：マッシュ にもあるが、対象外とする。
 *   - 画像・並び順・緊急募集・支援受付の設定は変更しない。
 *
 * 安全対策:
 *   - 実行前の値を backups/ にJSONで保存する
 *   - 対象は 61・62番の2件に限定し、2件でなければ中止
 *   - 対象の一文を含まない場合はスキップ（冪等）
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

// 全角チルダ(～)と半角チルダ(~)の両方に対応する。
const SENTENCE = /令和8年9月23日\s*[~～]\s*25日/g;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: all, error } = await sb
  .from("horses")
  .select("id, name, profile, image_url, sort_order, is_emergency_recruitment")
  .order("sort_order");
if (error) {
  console.error("馬マスタの取得に失敗:", error.message);
  process.exit(1);
}

const targets = all.filter((h) => /(^|[^0-9])(61|62)([^0-9]|$)/.test(h.name));
console.log("対象候補:");
for (const h of targets) console.log(`  ${JSON.stringify(h.name)} 紹介文=${JSON.stringify(h.profile)}`);
if (targets.length !== 2) {
  console.error(`\n中止: 61・62番として2件見つかるはずが ${targets.length} 件でした。`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.resolve(__dirname, `../backups/horses_61_62_profile_${stamp}.json`);
fs.mkdirSync(path.dirname(backupPath), { recursive: true });
fs.writeFileSync(backupPath, JSON.stringify(targets, null, 2), "utf8");
console.log(`\n実行前の値を保存しました → ${backupPath}`);

for (const h of targets) {
  const current = h.profile ?? "";
  if (!SENTENCE.test(current)) {
    SENTENCE.lastIndex = 0;
    console.log(`  スキップ: ${h.name}（対象の一文なし）`);
    continue;
  }
  SENTENCE.lastIndex = 0;
  const stripped = current.replace(SENTENCE, "").trim();
  const next = stripped === "" ? null : stripped;
  console.log(`  ${h.name}: ${JSON.stringify(current)} → ${JSON.stringify(next)}`);
  if (DRY) continue;
  const { error: upErr } = await sb.from("horses").update({ profile: next }).eq("id", h.id);
  if (upErr) {
    console.error(`  ! 更新失敗 ${h.name}: ${upErr.message}`);
    process.exit(1);
  }
}

if (DRY) {
  console.log("\n--dry のため変更しませんでした。");
} else {
  const { data: after } = await sb
    .from("horses")
    .select("name, profile, image_url, is_emergency_recruitment, sort_order")
    .in("id", targets.map((t) => t.id))
    .order("sort_order");
  console.log("\n=== 実行後 ===");
  for (const h of after ?? []) {
    console.log(
      `  ${JSON.stringify(h.name)} | 紹介文=${JSON.stringify(h.profile)} | 緊急=${h.is_emergency_recruitment} | 画像=${h.image_url ? "あり" : "なし"}`,
    );
  }
}
