/**
 * supabase/migrations/20261012b_community_admin_controls.sql を Supabase のデータベースへ適用する。
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
const sqlPath = path.join(root, "supabase", "migrations", "20261012b_community_admin_controls.sql");

try {
  await runQuery(ref, token, readFileSync(sqlPath, "utf8"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const rows = await runQuery(
  ref,
  token,
  "select (select audience from public.community_channels where kind = 'channel' and name = 'みんなの広場') as plaza_audience, " +
    "(select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'community_channel_members' and column_name = 'access') as access_column, " +
    "(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('community__set_member', 'community_admin_set_members', 'community_set_dm_label')) as new_functions",
);
const row = Array.isArray(rows) ? rows[0] : null;
console.log("20261012b_community_admin_controls.sql を適用しました。");
console.log(`  みんなの広場の対象者: ${row?.plaza_audience === "all" ? "全会員" : row?.plaza_audience}`);
console.log(`  community_channel_members.access: ${row?.access_column === 1 ? "あり" : "なし"} / 新しい関数: ${row?.new_functions}件`);
