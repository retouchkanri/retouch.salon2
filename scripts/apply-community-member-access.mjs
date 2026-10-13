/**
 * supabase/migrations/20261012_community_member_access.sql を Supabase のデータベースへ適用する。
 * 関数の本体に ; を含むため文ごとには分けず、全文を1回で送る（1つのトランザクション。途中で失敗したら何も残らない）。
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
const sqlPath = path.join(root, "supabase", "migrations", "20261012_community_member_access.sql");

try {
  await runQuery(ref, token, readFileSync(sqlPath, "utf8"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const channels = await runQuery(
  ref,
  token,
  "select name, visibility, auto_join, is_required from public.community_channels where kind = 'channel' and category in ('announcement', 'rank') order by sort_order",
);
const hidden = await runQuery(ref, token, "select count(*)::int as n from public.community_hidden_users");
console.log("20261012_community_member_access.sql を適用しました。");
for (const row of Array.isArray(channels) ? channels : []) {
  console.log(`  #${row.name}: ${row.visibility === "public" ? "公開（対象者が自動で参加）" : "非公開"} / 自動参加 ${row.auto_join ? "あり" : "なし"}${row.is_required ? " / 退出不可" : ""}`);
}
console.log(`  表示しないアカウント: ${Array.isArray(hidden) ? hidden[0]?.n : "?"}件`);
