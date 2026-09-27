/**
 * Import the authoritative member master (supabase/Retouchデーター送信.xlsx).
 *
 * Scope (agreed with the user): "会員データのみ置換"
 *   - DELETE all existing contracts + support_subscriptions, then rebuild from the file.
 *   - Customers are matched by email and UPSERTED (update existing / create missing) —
 *     never deleted, so the imported donations / 見学会 bookings / payment history
 *     and the few real logins stay intact.
 *   - Payments are preserved: before deleting contracts we null payments.contract_id
 *     (so the 14k payment rows survive; they just lose the old contract link).
 *
 * Rank → plan (by membership_plans NAME; アテンダー→メンバーズ, オーナーズ→リェリーフ per user):
 *   メンバーズ会員 / アテンダー会員        → メンバーズ会員 (A, ¥1800)
 *   サポーター会員                          → サポーター会員 (B, ¥3600)
 *   リェリーフ会員                          → リェリーフ会員 (C, ¥7200)
 *   オーナーズ会員                          → オーナーズ会員 (OWNER, ¥0)
 *   ヘルパーズ会員                          → 1口支援馬会員 (SUPPORT) + per-horse supports
 *   Retouch Ponys Team（RPT）支援メンバー   → RetouchPony【リタポ】メンバー (RPT, ¥3000)
 *   番外編 …ポニー救済支援チーム            → 目が負傷の「ガンガン」支援チーム (SPECIAL_TEAM, ¥1000)
 *   無料会員 / (blank)                      → no contract
 *
 * Modes:
 *   node scripts/import-members.mjs            → DRY RUN (parse + report, no DB writes)
 *   node scripts/import-members.mjs --backup   → read prod, write supabase/backups/pre-members-<ts>.json
 *   node scripts/import-members.mjs --apply     → requires a backup; upsert customers, replace contracts+supports
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

config({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "supabase", "Retouchデーター送信.xlsx");
const BACKUP_DIR = path.join(ROOT, "supabase", "backups");
const MODE = process.argv.includes("--apply") ? "apply" : process.argv.includes("--backup") ? "backup" : "dry";

const clean = (v) => (v == null ? "" : String(v).trim());
const pad = (n) => String(n).padStart(2, "0");
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

function normEmail(v) { const s = clean(v).toLowerCase(); return s.includes("@") && s.length >= 5 ? s : null; }
function parsePhone(v) { const s = clean(v).replace(/[^\d+]/g, ""); return s || null; }
function parsePostal(v) { const s = clean(v).replace(/[^\d]/g, ""); return s || null; }
function parseGender(v) { const s = clean(v).toLowerCase(); return s === "woman" ? "female" : s === "man" ? "male" : "unspecified"; }
function parseBirthday(v) {
  const s = clean(v);
  if (!s || s === "年月日") return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // M/D/YY (US)
  if (m) {
    let mo = +m[1], d = +m[2], y = +m[3];
    if (y < 100) y = y >= 26 ? 1900 + y : 2000 + y;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
    return null;
  }
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); // YYYY/M/D
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return null;
}

/** Rank string → membership_plans NAME (or null = no contract). */
function rankToPlanName(rank) {
  const r = clean(rank);
  if (!r || /無料/.test(r)) return null;
  if (/メンバーズ|アテンダー/.test(r)) return "メンバーズ会員";
  if (/サポーター/.test(r)) return "サポーター会員";
  if (/オーナーズ/.test(r)) return "オーナーズ会員";
  if (/リェリーフ|リリーフ/.test(r)) return "リェリーフ会員";
  if (/ヘルパーズ/.test(r)) return "1口支援馬会員";
  if (/RPT|Retouch|リタポ|ポニーズ|Ponys/i.test(r)) return "RetouchPony【リタポ】メンバー";
  if (/番外編|ポニー|ガンガン|救済/.test(r)) return "目が負傷の「ガンガン」支援チーム";
  if (/半口/.test(r)) return "半口支援馬会員";
  if (/支援/.test(r)) return "1口支援馬会員";
  return null;
}

/** First integer in a string (handles "37", "08：ピノ", "8×（４口）"). */
function firstInt(s) { const m = clean(s).match(/(\d+)/); return m ? parseInt(m[1], 10) : null; }
/** Horse number from a horse NAME (regular digits or circled ①..㊿). */
function horseNumFromName(name) {
  const n = firstInt(name);
  if (n != null) return n;
  const cp = clean(name).codePointAt(0) ?? 0;
  if (cp >= 0x2460 && cp <= 0x2473) return cp - 0x2460 + 1;   // ①..⑳
  if (cp >= 0x3251 && cp <= 0x325f) return cp - 0x3251 + 21;  // ㉑..㉟
  if (cp >= 0x32b1 && cp <= 0x32bf) return cp - 0x32b1 + 36;  // ㊱..㊿
  return null;
}

function parseMembers() {
  const wb = XLSX.readFile(FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false })
    .slice(1).filter((r) => r.some((c) => clean(c) !== ""));
  const out = [];
  const seen = new Set();
  let dupes = 0, noEmail = 0;
  for (const r of rows) {
    const email = normEmail(r[0]);
    if (!email) { noEmail++; continue; }
    if (seen.has(email)) { dupes++; continue; } // first row wins
    seen.add(email);
    const units = parseFloat(clean(r[6])) || null;
    const horses = [7, 8, 9, 10, 11, 12, 13].map((i) => firstInt(r[i])).filter((n) => n != null);
    out.push({
      email,
      rank: clean(r[1]),
      planName: rankToPlanName(r[1]),
      full_name: clean(r[2]) || email.split("@")[0],
      nickname: clean(r[3]),
      units,
      horses,
      phone: parsePhone(r[14]),
      postal_code: parsePostal(r[15]),
      address1: clean(r[16]) || null,
      gender: parseGender(r[17]),
      birthday: parseBirthday(r[18]),
    });
  }
  return { members: out, dupes, noEmail };
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service-role credentials missing in .env.local");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function main() {
  console.log(`\n=== import-members  [mode: ${MODE}] ===\n`);
  const { members, dupes, noEmail } = parseMembers();

  // Report
  const planDist = {};
  let withPlan = 0, withHorses = 0, horseRefs = 0, bdayOk = 0;
  for (const m of members) {
    planDist[m.planName ?? "（契約なし）"] = (planDist[m.planName ?? "（契約なし）"] || 0) + 1;
    if (m.planName) withPlan++;
    if (m.horses.length) { withHorses++; horseRefs += m.horses.length; }
    if (m.birthday) bdayOk++;
  }
  console.log(`members: ${members.length} (skipped no-email ${noEmail}, dup-email ${dupes})`);
  console.log(`with plan(契約): ${withPlan} | with 対象馬: ${withHorses} (${horseRefs} refs) | birthday parsed: ${bdayOk}`);
  console.log("plan distribution:", JSON.stringify(planDist, null, 0));

  const supabase = MODE === "dry" ? null : db();

  // Resolve plans + horses from DB (needed for dry validation too if we have a client; in dry we skip).
  if (MODE === "dry") {
    console.log("\n[dry-run] No DB writes. Run --backup then --apply to execute.");
    console.log("sample:", JSON.stringify(members[0], null, 2));
    return;
  }

  // plan name -> id (prefer active)
  const { data: plans } = await supabase.from("membership_plans").select("id,name,unit_amount,is_active");
  const planByName = new Map();
  for (const p of (plans ?? []).sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0))) {
    if (!planByName.has(p.name)) planByName.set(p.name, p);
  }
  const supportPlan = planByName.get("1口支援馬会員");
  const perUnit = supportPlan?.unit_amount ?? 12000;

  // horse number -> id (prefer regular-digit canonical name)
  const { data: horses } = await supabase.from("horses").select("id,name");
  const horseByNum = new Map();
  for (const h of horses ?? []) {
    const n = horseNumFromName(h.name);
    if (n == null) continue;
    const reg = /^\s*\d/.test(h.name);
    const cur = horseByNum.get(n);
    if (!cur || (reg && !cur.reg)) horseByNum.set(n, { id: h.id, reg });
  }

  if (MODE === "backup") {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { data: contracts } = await supabase.from("contracts").select("*").limit(100000);
    let supports = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("support_subscriptions").select("*").range(from, from + 999);
      if (!data || data.length === 0) break;
      supports = supports.concat(data); if (data.length < 1000) break;
    }
    const file = path.join(BACKUP_DIR, `pre-members-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ created_at: new Date().toISOString(), contracts: contracts ?? [], support_subscriptions: supports }, null, 2));
    console.log(`\n[backup] wrote ${file}\n  contracts: ${(contracts ?? []).length}, support_subscriptions: ${supports.length}`);
    return;
  }

  // ── APPLY ──
  if (!(fs.existsSync(BACKUP_DIR) && fs.readdirSync(BACKUP_DIR).some((f) => f.startsWith("pre-members-")))) {
    console.error("✗ No backup. Run `node scripts/import-members.mjs --backup` first.");
    process.exit(1);
  }

  // 1) Upsert customers by email.
  const emails = members.map((m) => m.email);
  const emailToId = new Map();
  for (const c of chunk(emails, 200)) {
    const { data, error } = await supabase.from("customers").select("id,email").in("email", c);
    if (error) throw error;
    for (const row of data ?? []) if (row.email) emailToId.set(row.email.toLowerCase(), row.id);
  }
  const toInsert = members.filter((m) => !emailToId.has(m.email)).map((m) => ({
    email: m.email, full_name: m.full_name, full_name_kana: m.nickname && m.nickname !== m.email ? m.nickname : null,
    phone: m.phone, postal_code: m.postal_code, address1: m.address1, gender: m.gender, birthday: m.birthday, status: "active",
  }));
  for (const c of chunk(toInsert, 300)) {
    const { data, error } = await supabase.from("customers").insert(c).select("id,email");
    if (error) throw error;
    for (const row of data ?? []) if (row.email) emailToId.set(row.email.toLowerCase(), row.id);
  }
  // update existing members' profile fields (concurrent batches)
  const toUpdate = members.filter((m) => emailToId.has(m.email));
  let updated = 0;
  for (const group of chunk(toUpdate, 25)) {
    await Promise.all(group.map(async (m) => {
      const { error } = await supabase.from("customers").update({
        full_name: m.full_name, full_name_kana: m.nickname && m.nickname !== m.email ? m.nickname : null,
        phone: m.phone, postal_code: m.postal_code, address1: m.address1, gender: m.gender, birthday: m.birthday,
      }).eq("id", emailToId.get(m.email));
      if (!error) updated++;
    }));
  }
  console.log(`[customers] created ${toInsert.length}, updated ${updated} (total resolved ${emailToId.size})`);

  // 2) Replace membership: preserve payments (null contract link), delete supports + contracts.
  {
    const { error } = await supabase.from("payments").update({ contract_id: null }).not("contract_id", "is", null);
    if (error) throw error;
  }
  { const { error } = await supabase.from("support_subscriptions").delete().not("id", "is", null); if (error) throw error; }
  { const { error } = await supabase.from("contracts").delete().not("id", "is", null); if (error) throw error; }
  console.log("[delete] cleared support_subscriptions + contracts (payments unlinked & preserved)");

  // 3) Create one contract per member that has a plan OR lists horses.
  const nowIso = new Date().toISOString();
  const contractPayloads = [];
  for (const m of members) {
    const cid = emailToId.get(m.email);
    if (!cid) continue;
    let planId = m.planName ? planByName.get(m.planName)?.id ?? null : null;
    if (!planId && m.horses.length) planId = supportPlan?.id ?? null; // free member supporting a horse
    if (!planId) continue;
    contractPayloads.push({ customer_id: cid, plan_id: planId, status: "active", started_at: nowIso, current_period_end: null });
  }
  const contractByCustomer = new Map();
  for (const c of chunk(contractPayloads, 500)) {
    const { data, error } = await supabase.from("contracts").insert(c).select("id,customer_id");
    if (error) throw error;
    for (const row of data ?? []) contractByCustomer.set(row.customer_id, row.id);
  }
  console.log(`[contracts] inserted ${contractPayloads.length}`);

  // 3.5) Ensure every 対象馬 horse exists — create missing ones by number so no support is dropped.
  const referenced = new Set();
  for (const m of members) for (const n of m.horses) referenced.add(n);
  const missingNums = [...referenced].filter((n) => !horseByNum.has(n)).sort((a, b) => a - b);
  if (missingNums.length) {
    const payload = missingNums.map((n, i) => ({
      name: String(n), name_kana: String(n), is_supportable: true,
      sort_order: 200 + i, profile: "Retouchデーター送信.xlsx から自動登録",
    }));
    const { data, error } = await supabase.from("horses").insert(payload).select("id,name");
    if (error) throw error;
    for (const row of data ?? []) { const num = horseNumFromName(row.name); if (num != null) horseByNum.set(num, { id: row.id, reg: true }); }
    console.log(`[horses] created ${missingNums.length} missing by number: ${missingNums.join(", ")}`);
  }

  // 4) Create support_subscriptions for each 対象馬.
  const supportPayloads = [];
  let unmatchedHorses = 0;
  for (const m of members) {
    if (!m.horses.length) continue;
    const cid = emailToId.get(m.email);
    const contractId = contractByCustomer.get(cid);
    if (!contractId) continue;
    const units = m.units && m.units > 0 ? m.units : 1;
    const monthly = Math.round(perUnit * units);
    for (const num of m.horses) {
      const h = horseByNum.get(num);
      if (!h) { unmatchedHorses++; continue; }
      supportPayloads.push({ contract_id: contractId, customer_id: cid, horse_id: h.id, units, monthly_amount: monthly, status: "active", started_at: nowIso });
    }
  }
  for (const c of chunk(supportPayloads, 500)) {
    const { error } = await supabase.from("support_subscriptions").insert(c); if (error) throw error;
  }
  console.log(`[supports] inserted ${supportPayloads.length} (unmatched horse refs: ${unmatchedHorses})`);
  console.log("\n✓ Member import complete.\n");
}

main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
