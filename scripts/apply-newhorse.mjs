/**
 * supabase/newhorse.sql を Supabase のデータベースへ適用する。
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

function splitSql(sql) {
  const statements = [];
  let current = "";
  for (let i = 0; i < sql.length; i += 1) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      const next = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, next);
      i = next - 1;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j - 1;
      continue;
    }
    if (sql[i] === ";") {
      const statement = current.trim();
      if (statement.replace(/--.*$/gm, "").trim()) statements.push(statement);
      current = "";
      continue;
    }
    current += sql[i];
  }
  const tail = current.trim();
  if (tail.replace(/--.*$/gm, "").trim()) statements.push(tail);
  return statements;
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
const sqlPath = path.join(root, "supabase", "newhorse.sql");
const statements = splitSql(readFileSync(sqlPath, "utf8"));

for (let index = 0; index < statements.length; index += 1) {
  try {
    await runQuery(ref, token, statements[index]);
  } catch (error) {
    const preview = statements[index].replace(/\s+/g, " ").slice(0, 120);
    console.error(`文 ${index + 1}/${statements.length} で停止しました: ${preview}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const columns = await runQuery(
  ref,
  token,
  "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'monthly_reports' order by ordinal_position",
);
const names = Array.isArray(columns) ? columns.map((row) => row.column_name).join(", ") : "";
console.log(`newhorse.sql を適用しました（${statements.length}文）。monthly_reports: ${names}`);
