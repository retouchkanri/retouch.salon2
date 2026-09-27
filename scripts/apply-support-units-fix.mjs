// 修正版.csv の口数（units）と月額（monthly_amount）を support_subscriptions に反映する。
//   - support_id で照合し、その場で UPDATE（顧客・馬・契約・Stripe・status・started_at は触らない）
//   - 安全ガード: CSV の customer_id / horse_id が DB と一致する行のみ更新
//   - 冪等: units と monthly_amount が既に一致していればスキップ
//   - CSV に無い既存行（孤立行・incomplete 行）は一切変更しない
// 適用前に scripts/_tmp_support_report.mjs でバックアップ取得済み。
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");

let raw = readFileSync("supabase/修正版.csv", "utf8");
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const csv = lines.slice(1).map((l) => {
  const f = l.split(",");
  return {
    id: f[0], customer_id: f[1], name: f[3],
    horse_id: f[4], horse_name: f[5], units: Number(f[6]), amount: Number(f[7]),
  };
});

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 現状を取得
let all = [];
let from = 0;
for (;;) {
  const { data, error } = await sb.from("support_subscriptions").select("id,customer_id,horse_id,units,monthly_amount").range(from, from + 999);
  if (error) { console.error("read error:", error.message); process.exit(1); }
  all = all.concat(data);
  if (data.length < 1000) break;
  from += 1000;
}
const dbById = new Map(all.map((r) => [r.id, r]));

let updated = 0, skippedSame = 0, missing = 0, guardMismatch = 0, failed = 0;
for (const c of csv) {
  const db = dbById.get(c.id);
  if (!db) { missing++; console.warn("MISSING support_id (skip):", c.id, c.name, c.horse_name); continue; }
  if (db.customer_id !== c.customer_id || db.horse_id !== c.horse_id) {
    guardMismatch++;
    console.warn("GUARD mismatch (skip):", c.id, "csv", c.customer_id, c.horse_id, "db", db.customer_id, db.horse_id);
    continue;
  }
  if (Number(db.units) === c.units && Number(db.monthly_amount) === c.amount) { skippedSame++; continue; }
  if (DRY) { updated++; continue; }
  const { error } = await sb
    .from("support_subscriptions")
    .update({ units: c.units, monthly_amount: c.amount })
    .eq("id", c.id);
  if (error) { failed++; console.error("UPDATE failed:", c.id, error.message); continue; }
  updated++;
}

console.log(DRY ? "--- DRY RUN ---" : "--- APPLIED ---");
console.log("updated:", updated, "| already-correct:", skippedSame, "| missing:", missing, "| guard-mismatch:", guardMismatch, "| failed:", failed);
