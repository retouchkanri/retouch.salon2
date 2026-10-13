/**
 * supabase/migrations/20261013_community_public_channels.sql を Supabase のデータベースへ適用する。
 * 関数の本体に ; を含むため文ごとには分けず、全文を1回で送る（1つのトランザクション）。
 * トークンは .env.local の SUPABASE_ACCESS_TOKEN から読む。引数やログには出さない。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnv(file) {
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

async function runQuery(ref, token, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SQLの適用に失敗しました (${response.status}): ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

const root = process.cwd();
loadEnv(path.join(root, ".env.local"));

const token = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!token || !supabaseUrl) {
  console.error("SUPABASE_ACCESS_TOKEN または NEXT_PUBLIC_SUPABASE_URL がありません。");
  process.exit(1);
}
const ref = new URL(supabaseUrl).hostname.split(".")[0];
const sqlPath = path.join(root, "supabase", "migrations", "20261013_community_public_channels.sql");

try {
  await runQuery(ref, token, readFileSync(sqlPath, "utf8"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const rows = await runQuery(
  ref,
  token,
  "select name, visibility, audience, auto_join from public.community_channels where kind = 'channel' and name in ('みんなの広場', '自己紹介', '質問・相談', '写真・動画', 'お知らせ', 'ご意見箱') order by sort_order",
);
console.log("20261013_community_public_channels.sql を適用しました。");
for (const row of Array.isArray(rows) ? rows : []) {
  const open = row.visibility === "public" && row.audience === "all" && row.auto_join;
  console.log(`  #${row.name}: ${open ? "全会員に表示（自動参加）" : `${row.visibility} / ${row.audience} / 自動参加 ${row.auto_join ? "あり" : "なし"}`}`);
}
