/**
 * Import the client's real "見学会" (Chiba / Osaka) and past-donation data.
 *
 *   supabase/千葉の見学会.csv   → events(type=visit, location=千葉) + bookings + customers
 *   supabase/大阪見学会.csv     → events(type=visit, location=大阪) + bookings + customers
 *   supabase/寄付過去.csv       → donations + customers
 *
 * Per the agreed scope:
 *   - Deletes ONLY: all events of type "visit" + their bookings, and ALL donations.
 *   - Keeps: customers / contracts / supports / payments / private_visit events.
 *   - Customers are matched by email and CREATED when new (never deleted).
 *
 * Modes (safe by default):
 *   node scripts/import-visits-donations.mjs            → DRY RUN (parses CSVs, no DB access except a count read)
 *   node scripts/import-visits-donations.mjs --backup   → read prod, write supabase/backups/pre-import-<ts>.json (read-only on prod)
 *   node scripts/import-visits-donations.mjs --apply     → REQUIRES a backup file; deletes visit events+bookings+donations, then imports
 *
 * Files are Shift-JIS (CP932); decoded via TextDecoder.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SUPA_DIR = path.join(ROOT, "supabase");
const BACKUP_DIR = path.join(SUPA_DIR, "backups");

// `--donations-only` re-imports ONLY donations (fix dates) without touching events/bookings.
const DONATIONS_ONLY = process.argv.includes("--donations-only");
const MODE = (process.argv.includes("--apply") || DONATIONS_ONLY)
  ? "apply"
  : process.argv.includes("--backup")
    ? "backup"
    : "dry";

const dec = new TextDecoder("shift-jis");

// ── CSV parsing (RFC-4180-ish: quoted fields, escaped quotes, embedded newlines) ──
function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function readCsv(name) {
  const buf = fs.readFileSync(path.join(SUPA_DIR, name));
  const rows = parseCsv(dec.decode(buf));
  // Drop fully-empty rows.
  return rows.filter((r) => r.some((c) => c && c.trim() !== ""));
}

const clean = (v) => (v == null ? "" : String(v).trim());
const orNull = (v) => { const s = clean(v); return s === "" ? null : s; };

function normEmail(v) {
  const s = clean(v).toLowerCase();
  if (!s.includes("@") || s.length < 5) return null;
  return s;
}

function normPhone(v) {
  const s = clean(v);
  if (!s) return null;
  return s.replace(/[^\d+]/g, "") || null;
}

function normPostal(v) {
  const s = clean(v);
  if (!s) return null;
  const d = s.replace(/[^\d]/g, "");
  return d || null;
}

function parseAmount(v) {
  const s = clean(v);
  if (!s) return null;
  // Reject values that are actually a misplaced date (column drift in some rows):
  //   "2025/10/28", "2026.3.27", "2025年3月27日", or a bare "20260327".
  if (/\d{4}\s*[\/.\-年]\s*\d{1,2}\s*[\/.\-月]\s*\d{1,2}/.test(s)) return null;
  if (/^\d{8}$/.test(s)) return null;
  // Ranges / free text ("2,000から3,000ほど", "2000?3000", "2000〜3000") → take the first amount.
  const seg = s.split(/から|まで|〜|～|~|ほど|程度|程|[?？]|[‐−—–-]/)[0];
  // "N万(M千)?" notation.
  const man = seg.match(/([\d,]+)\s*万(?:\s*([\d,]+)\s*千)?/);
  if (man) {
    const base = Number(man[1].replace(/,/g, "")) * 10000;
    const sen = man[2] ? Number(man[2].replace(/,/g, "")) * 1000 : 0;
    const total = base + sen;
    return total > 0 ? total : null;
  }
  const m = seg.match(/[\d,]+/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a JST date → "YYYY-MM-DD". Handles Reiwa, 西暦, dots, and month/day-only (uses fallbackYear). */
function parseJpDate(v, fallbackYear) {
  const s = clean(v);
  if (!s) return null;
  let m;
  // 令和N年M月D日
  if ((m = s.match(/令和\s*(\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/))) {
    const y = 2018 + Number(m[1]);
    return iso(y, m[2], m[3]);
  }
  // YYYYMMDD (8 digits, no separators)
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    return iso(m[1], m[2], m[3]);
  }
  // YYYY[年/.-]MM[月/.-]DD
  if ((m = s.match(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/))) {
    return iso(m[1], m[2], m[3]);
  }
  // M月D日 (no year)
  if ((m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)) && fallbackYear) {
    return iso(fallbackYear, m[1], m[2]);
  }
  return null;
}
function iso(y, mo, d) {
  const Y = Number(y), M = Number(mo), D = Number(d);
  // reject bad source data (out-of-range month/day, or a non-plausible year)
  if (!(Y >= 2000 && Y <= 2100) || !(M >= 1 && M <= 12) || !(D >= 1 && D <= 31)) return null;
  return `${Y}-${String(M).padStart(2, "0")}-${String(D).padStart(2, "0")}`;
}
function yearOf(v, fallback = 2025) {
  const s = clean(v);
  const m = s.match(/(\d{4})/);
  return m ? Number(m[1]) : fallback;
}
/** JST timestamp at 10:00 for an event date, else now-ish ISO for a YYYY-MM-DD. */
const atJst = (ymd, hhmm = "10:00") => `${ymd}T${hhmm}:00+09:00`;

const validMD = (mo, d) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;

/** Parse the form submission timestamp (col "Date", always full e.g. "2025/12/19 20:44"). */
function parseSubmission(v) {
  const s = clean(v);
  const m = s.match(/(\d{4})\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return validMD(mo, d) && y >= 2000 && y <= 2100 ? { y, mo, d } : null;
}

/** Extract month/day (+optional year) from the 入金予定日 cell — many shapes, donors mistype years. */
function extractMonthDay(v) {
  const s = clean(v);
  if (!s) return null;
  let m;
  if ((m = s.match(/令和\s*(\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/))) return { y: 2018 + Number(m[1]), mo: +m[2], d: +m[3] };
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return { y: +m[1], mo: +m[2], d: +m[3] };
  if ((m = s.match(/(\d{4})\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})/))) return { y: +m[1], mo: +m[2], d: +m[3] };
  if ((m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})/))) return { mo: +m[1], d: +m[2] };
  return null;
}

/**
 * Correct donation date: take the deposit month/day from 入金予定日 (col12), but
 * SNAP THE YEAR to whichever makes the date closest to the submission date (col1).
 * Donors frequently mistype the year (e.g. "20261222" submitted 2025/12/19, or
 * "2026年11月12日" whose message says 2025/11/12) — the submission timestamp is the
 * reliable anchor. Falls back to the submission date when the deposit cell is unusable.
 */
function donationDate(col12, col1) {
  const sub = parseSubmission(col1);
  const md = extractMonthDay(col12);
  if (!md || !validMD(md.mo, md.d)) {
    return sub ? iso(sub.y, sub.mo, sub.d) : null;
  }
  if (!sub) {
    const y = md.y && md.y >= 2000 && md.y <= 2100 ? md.y : 2025;
    return iso(y, md.mo, md.d);
  }
  const subSerial = Date.UTC(sub.y, sub.mo - 1, sub.d);
  let best = sub.y, bestDiff = Infinity;
  for (const y of [sub.y - 1, sub.y, sub.y + 1]) {
    const diff = Math.abs(Date.UTC(y, md.mo - 1, md.d) - subSerial);
    if (diff < bestDiff) { bestDiff = diff; best = y; }
  }
  return iso(best, md.mo, md.d);
}

// ── Parse the two 見学会 files (identical positional layout; Osaka header has an
//    extra "参加ご希望日" label, but DATA columns line up in both). ──
// Positions: 2姓 3名 4セイ 5メイ 12電話 13email 8〒 9都道府県 10市区町村 11丁目番地
//            16=参加希望日(date) 17=option  family blocks @18/26/34 (お名前 @20/28/36)
function parseVisits(name, location) {
  const rows = readCsv(name);
  const out = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sei = clean(r[2]);
    const mei = clean(r[3]);
    const email = normEmail(r[13]);
    if (!sei && !mei && !email) { skipped++; continue; }

    const submittedYear = yearOf(r[1]);
    const dateYmd = parseJpDate(r[16], submittedYear);
    const option = clean(r[17]);

    // accompanying family members: name slots at 20 / 28 / 36
    const family = [];
    for (const base of [18, 26, 34]) {
      const fname = clean(r[base + 2]);
      if (fname) family.push(fname);
    }
    const partySize = 1 + family.length;

    const noteParts = [];
    if (option) noteParts.push(option.replace(/\n/g, " / "));
    if (family.length) noteParts.push(`同伴: ${family.join("、")}`);
    const other = clean(r[name.includes("千葉") ? 41 : 42]);
    if (other) noteParts.push(other.replace(/\n/g, " "));
    const note = noteParts.join(" ｜ ").slice(0, 500) || null;

    out.push({
      rowNumber: i + 1,
      location,
      dateYmd,
      submittedAt: r[1] ? new Date(clean(r[1])) : null,
      memberType: clean(r[14]) || clean(r[15]) || null,
      customer: {
        email,
        full_name: `${sei}${mei ? " " + mei : ""}`.trim() || (email ? email.split("@")[0] : "（無名）"),
        full_name_kana: [clean(r[4]), clean(r[5])].filter(Boolean).join(" ") || null,
        phone: normPhone(r[12]),
        postal_code: normPostal(r[8]),
        address1: [clean(r[9]), clean(r[10])].filter(Boolean).join("") || null,
        address2: orNull(r[11]),
      },
      partySize,
      note,
    });
  }
  return { rows: out, skipped };
}

function parseDonations(name) {
  const rows = readCsv(name);
  const out = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sei = clean(r[2]);
    const mei = clean(r[3]);
    const email = normEmail(r[11]);
    const amount = parseAmount(r[13]);
    if (!sei && !mei && !email && !amount) { skipped++; continue; }
    if (!amount) { skipped++; continue; }

    const dateYmd = donationDate(r[12], r[1]);
    const handle = clean(r[14]);
    const message = clean(r[15]).replace(/\n+/g, " ") || null;

    out.push({
      rowNumber: i + 1,
      customer: {
        email,
        full_name: `${sei}${mei ? " " + mei : ""}`.trim() || (email ? email.split("@")[0] : "（匿名）"),
        full_name_kana: [clean(r[4]), clean(r[5])].filter(Boolean).join(" ") || null,
        phone: normPhone(r[10]),
        postal_code: normPostal(r[6]),
        address1: [clean(r[7]), clean(r[8])].filter(Boolean).join("") || null,
        address2: orNull(r[9]),
      },
      donorName: `${sei}${mei ? " " + mei : ""}`.trim() || handle || "（匿名）",
      donorEmail: email,
      amount,
      message,
      note: handle ? `ハンドルネーム: ${handle}` : null,
      donatedAt: dateYmd ? atJst(dateYmd, "12:00") : null,
    });
  }
  return { rows: out, skipped };
}

// ── Supabase ──
function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service-role credentials missing in .env.local");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

async function main() {
  console.log(`\n=== import-visits-donations  [mode: ${MODE}] ===\n`);

  const chiba = parseVisits("千葉の見学会.csv", "千葉");
  const osaka = parseVisits("大阪見学会.csv", "大阪");
  const donations = parseDonations("寄付過去.csv");
  const visits = [...chiba.rows, ...osaka.rows];

  // Build event set (location + date).
  const eventKey = (v) => `${v.location}|${v.dateYmd ?? "未定"}`;
  const eventMap = new Map();
  for (const v of visits) {
    const k = eventKey(v);
    if (!eventMap.has(k)) eventMap.set(k, { location: v.location, dateYmd: v.dateYmd, seats: 0, bookings: 0 });
    const e = eventMap.get(k);
    e.seats += v.partySize;
    e.bookings += 1;
  }

  // Unique customers by email across all rows (rows without email handled individually).
  const emailSet = new Set();
  for (const v of [...visits, ...donations.rows]) if (v.customer.email) emailSet.add(v.customer.email);

  const visitNoEmail = visits.filter((v) => !v.customer.email).length;
  const donoNoEmail = donations.rows.filter((d) => !d.customer.email).length;
  const totalDonationYen = donations.rows.reduce((a, d) => a + d.amount, 0);

  console.log("── Parse summary ──");
  console.log(`千葉見学会:   ${chiba.rows.length} rows (skipped ${chiba.skipped})`);
  console.log(`大阪見学会:   ${osaka.rows.length} rows (skipped ${osaka.skipped})`);
  console.log(`寄付過去:     ${donations.rows.length} rows (skipped ${donations.skipped}), 合計 ¥${totalDonationYen.toLocaleString()}`);
  console.log(`見学会 events (location+date): ${eventMap.size}`);
  for (const [k, e] of [...eventMap.entries()].sort()) {
    console.log(`   • ${k}  → 予約 ${e.bookings} 件 / 述べ ${e.seats} 名${e.dateYmd ? "" : "  ⚠ 日付未解決"}`);
  }
  console.log(`unique customer emails: ${emailSet.size}`);
  console.log(`rows without email — visits: ${visitNoEmail}, donations: ${donoNoEmail}`);

  const dateUnresolvedVisits = visits.filter((v) => !v.dateYmd).length;
  const dateUnresolvedDono = donations.rows.filter((d) => !d.donatedAt).length;
  if (dateUnresolvedVisits) console.log(`⚠ 見学会で日付未解決: ${dateUnresolvedVisits} 行`);
  if (dateUnresolvedDono) console.log(`⚠ 寄付で日付未解決: ${dateUnresolvedDono} 行`);

  if (MODE === "dry") {
    console.log("\n[dry-run] No database changes. Re-run with --backup then --apply to execute.\n");
    // sample
    console.log("sample visit:", JSON.stringify(visits[0], null, 2));
    console.log("sample donation:", JSON.stringify(donations.rows[0], null, 2));
    return;
  }

  const supabase = db();

  if (MODE === "backup") {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { data: visitEvents } = await supabase.from("events").select("*").eq("type", "visit");
    const visitIds = (visitEvents ?? []).map((e) => e.id);
    let visitBookings = [];
    for (const c of chunk(visitIds, 100)) {
      const { data } = await supabase.from("bookings").select("*").in("event_id", c);
      visitBookings = visitBookings.concat(data ?? []);
    }
    const { data: dono } = await supabase.from("donations").select("*").limit(100000);
    const file = path.join(BACKUP_DIR, `pre-import-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({
      created_at: new Date().toISOString(),
      visit_events: visitEvents ?? [],
      visit_bookings: visitBookings,
      donations: dono ?? [],
    }, null, 2));
    console.log(`\n[backup] wrote ${file}`);
    console.log(`  visit events: ${(visitEvents ?? []).length}, visit bookings: ${visitBookings.length}, donations: ${(dono ?? []).length}`);
    console.log(`  → review it, then run with --apply\n`);
    return;
  }

  // ── APPLY ──
  // Safety gate: require a backup file to exist first.
  const haveBackup = fs.existsSync(BACKUP_DIR) && fs.readdirSync(BACKUP_DIR).some((f) => f.startsWith("pre-import-"));
  if (!haveBackup) {
    console.error("✗ No backup found. Run `node scripts/import-visits-donations.mjs --backup` first.");
    process.exit(1);
  }

  // 1) Resolve / create customers by email.
  const emailToId = new Map();
  const emails = [...emailSet];
  for (const c of chunk(emails, 200)) {
    const { data, error } = await supabase.from("customers").select("id,email").in("email", c);
    if (error) throw error;
    for (const row of data ?? []) if (row.email) emailToId.set(row.email.toLowerCase(), row.id);
  }
  // Build create payloads for unknown emails (first occurrence wins for profile fields).
  const toCreate = new Map();
  for (const v of [...visits, ...donations.rows]) {
    const e = v.customer.email;
    if (!e || emailToId.has(e) || toCreate.has(e)) continue;
    toCreate.set(e, {
      full_name: v.customer.full_name,
      full_name_kana: v.customer.full_name_kana,
      email: e,
      phone: v.customer.phone,
      postal_code: v.customer.postal_code,
      address1: v.customer.address1,
      address2: v.customer.address2,
      status: "active",
    });
  }
  for (const c of chunk([...toCreate.values()], 300)) {
    const { data, error } = await supabase.from("customers").insert(c).select("id,email");
    if (error) throw error;
    for (const row of data ?? []) if (row.email) emailToId.set(row.email.toLowerCase(), row.id);
  }
  console.log(`[customers] matched/created: ${emailToId.size} (newly created ${toCreate.size})`);

  // Helper: create a standalone customer (no email) and return id.
  async function createBare(cust) {
    const { data, error } = await supabase.from("customers")
      .insert({ ...cust, status: "active" }).select("id").single();
    if (error) throw error;
    return data.id;
  }

  // 2) DELETE. Donations are always replaced; visit events+bookings only on a full run.
  if (!DONATIONS_ONLY) {
    const { data: oldVisitEvents } = await supabase.from("events").select("id").eq("type", "visit");
    const oldIds = (oldVisitEvents ?? []).map((e) => e.id);
    for (const c of chunk(oldIds, 100)) {
      const { error } = await supabase.from("bookings").delete().in("event_id", c);
      if (error) throw error;
    }
    if (oldIds.length) {
      const { error } = await supabase.from("events").delete().eq("type", "visit");
      if (error) throw error;
    }
    console.log(`[delete] removed ${oldIds.length} visit events (+bookings)`);
  }
  {
    const { error } = await supabase.from("donations").delete().not("id", "is", null);
    if (error) throw error;
  }
  console.log(`[delete] removed all donations`);

  if (!DONATIONS_ONLY) {
  // 3) Insert events (one per location+date), capture ids.
  const evKeyToId = new Map();
  const evPayloads = [];
  for (const [k, e] of eventMap.entries()) {
    const ymd = e.dateYmd ?? "2025-01-01";
    evPayloads.push({
      _k: k,
      type: "visit",
      title: `${e.location}見学会（${e.dateYmd ?? "日付未定"}）`,
      starts_at: atJst(ymd, "10:00"),
      ends_at: null,
      capacity: Math.max(e.seats, 1),
      location: e.location,
      supporters_only: false,
      // Imported as admin records — not auto-published to the public booking site.
      is_published: false,
      description: null,
    });
  }
  // Insert one at a time (only ~14) and capture each id directly — avoids
  // matching on starts_at, which Postgres returns normalized to UTC.
  for (const p of evPayloads) {
    const { _k, ...rest } = p;
    const { data, error } = await supabase.from("events").insert(rest).select("id").single();
    if (error) throw error;
    evKeyToId.set(_k, data.id);
  }
  console.log(`[events] inserted ${evPayloads.length}`);

  // 4) Insert bookings (dedupe by customer_id+event_id, keep max party_size).
  const bookingMap = new Map();
  for (const v of visits) {
    let cid = v.customer.email ? emailToId.get(v.customer.email) : null;
    if (!cid) cid = await createBare(v.customer);
    const eid = evKeyToId.get(eventKey(v));
    if (!eid) continue;
    const key = `${cid}|${eid}`;
    const prev = bookingMap.get(key);
    const payload = {
      customer_id: cid,
      event_id: eid,
      party_size: v.partySize,
      note: v.note,
      status: "reserved",
      booked_at: v.submittedAt && !isNaN(v.submittedAt) ? v.submittedAt.toISOString() : new Date().toISOString(),
    };
    if (!prev || v.partySize > prev.party_size) bookingMap.set(key, payload);
  }
  const bookings = [...bookingMap.values()];
  for (const c of chunk(bookings, 500)) {
    const { error } = await supabase.from("bookings").insert(c);
    if (error) throw error;
  }
  console.log(`[bookings] inserted ${bookings.length}`);
  } // end !DONATIONS_ONLY (events + bookings)

  // 5) Insert donations.
  const donoPayloads = donations.rows.map((d) => ({
    customer_id: d.donorEmail ? emailToId.get(d.donorEmail) ?? null : null,
    donor_name: d.donorName,
    donor_email: d.donorEmail,
    amount: d.amount,
    message: d.message,
    note: d.note,
    status: "pending",
    payment_method: "bank_transfer",
    donated_at: d.donatedAt ?? new Date().toISOString(),
    confirmed_at: null,
  }));
  for (const c of chunk(donoPayloads, 500)) {
    const { error } = await supabase.from("donations").insert(c);
    if (error) throw error;
  }
  console.log(`[donations] inserted ${donoPayloads.length}`);

  console.log("\n✓ Import complete.\n");
}

main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
