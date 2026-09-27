// =====================================================================
// 馬画像 一括アップロード
//
// 指定フォルダ内の画像を、馬名/馬番で自動照合し、Supabase Storage
// （avatars バケットの horses/ 配下）へアップロードして horses.image_url を更新する。
//
// ファイル名の付け方（どちらでもOK）:
//   - 馬番のみ:        23.jpg / 00.png / 27.webp
//   - 馬番＋馬名:      23アンジュ.jpg / 27チャコ.png（区切り文字 : ： 　 空白なんでも可）
//   - 馬名のみ:        サクラエース.jpg（番号のない馬用）
//
// 使い方:
//   1) 画像を horse-images/ フォルダ（リポジトリ直下）に入れる
//   2) ドライラン（照合結果の確認・書き込みなし）:
//        node scripts/bulk-upload-horse-images.mjs
//   3) 問題なければ反映:
//        node scripts/bulk-upload-horse-images.mjs --apply
//
//   別フォルダを使う場合: --dir=path/to/folder
//
// 安全設計: 既定はドライラン。--apply 指定時のみアップロード＆更新。
//   保存パスは horses/<馬ID>.<拡張子> 固定（upsert）なので、再実行しても重複しない。
// =====================================================================
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";

const APPLY = process.argv.includes("--apply");
const DIR = (process.argv.find((a) => a.startsWith("--dir=")) || "").split("=")[1] || "horse-images";
const BUCKET = "avatars";
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const CONTENT_TYPE = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

if (!existsSync(DIR)) {
  console.log(`[中止] フォルダが見つかりません: ${DIR}`);
  console.log("画像を入れたフォルダを用意し、--dir= で指定するか、horse-images/ に置いてください。");
  process.exit(1);
}

// 1) 馬一覧
const { data: horses, error } = await sb.from("horses").select("id, name, image_url").order("sort_order");
if (error) { console.log("馬取得エラー:", error.message); process.exit(1); }

// 馬名の先頭の数字（例「23：アンジュ」→ 23）と、名前本体（コロン以降）を抽出。
function horseKeys(name) {
  const numMatch = name.match(/^\s*(\d{1,3})/);
  const num = numMatch ? String(Number(numMatch[1])) : null; // 先頭ゼロを正規化（00→0, 03→3）
  const body = name.replace(/^\s*\d{1,3}\s*[:：　\s]*/, "").trim(); // 「アンジュ」など
  return { num, body, full: name };
}
const horseInfos = horses.map((h) => ({ ...h, ...horseKeys(h.name) }));

// 2) フォルダ内の画像
const files = readdirSync(DIR).filter((f) => ALLOWED_EXT.has(extname(f).toLowerCase()));
console.log(`対象フォルダ: ${DIR}  画像ファイル数: ${files.length}\n`);

// ファイル名から照合キーを作る。
function matchHorse(fileName) {
  const stem = basename(fileName, extname(fileName)).trim();
  const numMatch = stem.match(/^\s*(\d{1,3})/);
  const fileNum = numMatch ? String(Number(numMatch[1])) : null;

  // 1) 馬番一致を最優先
  if (fileNum != null) {
    const byNum = horseInfos.filter((h) => h.num === fileNum);
    if (byNum.length === 1) return byNum[0];
    if (byNum.length > 1) {
      // 同番が複数（通常無い）→ 名前でさらに絞る
      const byBoth = byNum.find((h) => h.body && stem.includes(h.body));
      if (byBoth) return byBoth;
    }
  }
  // 2) 名前（本体）一致
  const byName = horseInfos.filter((h) => h.body && (stem.includes(h.body) || h.full.includes(stem)));
  if (byName.length === 1) return byName[0];

  return null;
}

const plan = [];   // {file, horse}
const unmatched = [];
const usedHorseIds = new Set();
for (const f of files) {
  const h = matchHorse(f);
  if (!h) { unmatched.push(f); continue; }
  if (usedHorseIds.has(h.id)) { unmatched.push(`${f}（馬「${h.name}」は別ファイルと重複）`); continue; }
  usedHorseIds.add(h.id);
  plan.push({ file: f, horse: h });
}

console.log("=== 照合結果（プレビュー） ===");
for (const p of plan) {
  const had = p.horse.image_url ? "（既存画像あり→上書き）" : "";
  console.log(`  ${p.file}  →  ${p.horse.name} ${had}`);
}
if (unmatched.length) {
  console.log("\n--- 照合できなかったファイル（ファイル名に馬番か馬名を入れてください）---");
  for (const u of unmatched) console.log(`  ${u}`);
}
const horsesWithout = horseInfos.filter((h) => !h.image_url && !usedHorseIds.has(h.id));
if (horsesWithout.length) {
  console.log(`\n--- 画像が未登録のままの馬（${horsesWithout.length}頭）---`);
  for (const h of horsesWithout) console.log(`  ${h.name}`);
}

console.log(`\n登録対象: ${plan.length}件 / 照合不可: ${unmatched.length}件`);

if (!APPLY) {
  console.log("\n*** ドライラン（書き込みなし）。問題なければ --apply を付けて実行してください。 ***");
  process.exit(0);
}

// 3) アップロード＆更新
let ok = 0;
for (const p of plan) {
  const ext = extname(p.file).toLowerCase();
  const path = `horses/${p.horse.id}${ext}`;
  const buf = readFileSync(join(DIR, p.file));
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: CONTENT_TYPE[ext] ?? "image/jpeg", upsert: true });
  if (upErr) { console.log(`  [失敗] ${p.file}: ${upErr.message}`); continue; }
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  // 同一パスへ upsert するため、画像差し替え時にキャッシュが残らないよう
  // ファイルサイズをバージョンとしてクエリに付与する（中身が変わればURLも変わる）。
  const url = pub?.publicUrl ? `${pub.publicUrl}?v=${buf.length}` : pub?.publicUrl;
  const { error: updErr } = await sb.from("horses").update({ image_url: url }).eq("id", p.horse.id);
  if (updErr) { console.log(`  [失敗] DB更新 ${p.horse.name}: ${updErr.message}`); continue; }
  ok++;
}
console.log(`\n反映完了: ${ok}/${plan.length} 件の馬画像を登録しました。`);
process.exit(0);
