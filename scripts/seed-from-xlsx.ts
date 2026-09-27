/**
 * Import the client's internal management spreadsheet
 * (docs/milestone1/管理データー【管理厳重】.xlsx) into Supabase so that
 * Milestone 2 features can be exercised against realistic data.
 *
 * The script is idempotent:
 *   - customers are upserted by email
 *   - horses are upserted by name (kept as they appear in the sheet)
 *   - contracts / support_subscriptions are only inserted when missing
 *
 * In addition to the raw rows it generates a small, randomised set of
 * donations / payments / bookings so every MyPage and Admin screen has
 * something to show.
 *
 *   npx tsx scripts/seed-from-xlsx.ts
 *
 * Requirements: .env.local with NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY. Safe to re-run.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import * as XLSX from "xlsx";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

type Row = {
  contractDate: Date | null;
  horseName: string | null;
  units: number | null;
  remark: string | null;
  fullName: string | null;
  nickname: string | null;
  rank: string | null;
  email: string | null;
  postalCode: string | null;
  address: string | null;
  status: string | null;
};

// Column indices in the sheet (see scripts/inspect-xlsx.ts output).
const COL = {
  flag: 0,
  contractDate: 1,
  horseName: 2,
  units: 3,
  pad1: 4,
  status: 5,
  remark: 6,
  fullName: 7,
  nickname: 8,
  rank: 9,
  email: 10,
  postalCode: 12,
  address: 13,
} as const;

function findXlsx(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = findXlsx(full);
      if (sub) return sub;
    } else if (entry.name.toLowerCase().endsWith(".xlsx")) {
      return full;
    }
  }
  return null;
}

function excelSerialToDate(serial: number): Date {
  // Excel epoch starts 1899-12-30 (to account for the leap-year bug).
  const ms = (serial - 25569) * 86400 * 1000;
  return new Date(ms);
}

function parseCell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function parseUnits(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (v < 10000 || v > 60000) return null;
    return excelSerialToDate(v);
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseRow(raw: any[]): Row {
  const email = parseCell(raw[COL.email])?.toLowerCase() ?? null;
  return {
    contractDate: parseDate(raw[COL.contractDate]),
    horseName: parseCell(raw[COL.horseName]),
    units: parseUnits(raw[COL.units]),
    remark: parseCell(raw[COL.remark]),
    fullName: parseCell(raw[COL.fullName]),
    nickname: parseCell(raw[COL.nickname]),
    rank: parseCell(raw[COL.rank]),
    email,
    postalCode: parseCell(raw[COL.postalCode]),
    address: parseCell(raw[COL.address]),
    status: parseCell(raw[COL.status]),
  };
}

type PlanKey = { code: string; name: string } | null;

function rankToPlan(rank: string | null): PlanKey {
  if (!rank) return null;
  const r = rank.trim();
  if (/無料/.test(r)) return null;
  if (/メンバーズ/.test(r)) return { code: "B", name: "B会員" };
  if (/アテンダー/.test(r)) return { code: "A", name: "A会員" };
  if (/オーナーズ/.test(r)) return { code: "C", name: "C会員" };
  if (/リェリーフ|リリーフ|Retouch|RPT|ポニー|サポーター/.test(r))
    return { code: "SPECIAL_TEAM", name: "特別チーム会員" };
  if (/半口/.test(r)) return { code: "SUPPORT", name: "半口支援" };
  if (/支援/.test(r)) return { code: "SUPPORT", name: "1口支援" };
  return null;
}

function normaliseEmail(raw: string | null): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (!e.includes("@")) return null;
  return e;
}

function pickStatus(_row: Row, rand: () => number): string {
  const r = rand();
  if (r < 0.02) return "withdrawn";
  if (r < 0.06) return "suspended";
  return "active";
}

function pickContractStatus(rand: () => number):
  | "active"
  | "past_due"
  | "canceled"
  | "paused" {
  const r = rand();
  if (r < 0.82) return "active";
  if (r < 0.9) return "past_due";
  if (r < 0.96) return "canceled";
  return "paused";
}

// Simple seedable PRNG so runs are reproducible.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function ensurePlans(
  client: SupabaseClient,
): Promise<Map<string, { id: string; monthly_amount: number; unit_amount: number | null }>> {
  const { data, error } = await client
    .from("membership_plans")
    .select("id, code, name, monthly_amount, unit_amount");
  if (error) throw error;
  const map = new Map<string, { id: string; monthly_amount: number; unit_amount: number | null }>();
  for (const p of data ?? []) {
    map.set(`${p.code}:${p.name}`, {
      id: p.id as string,
      monthly_amount: p.monthly_amount as number,
      unit_amount: (p.unit_amount as number | null) ?? null,
    });
  }
  return map;
}

async function ensureHorses(
  client: SupabaseClient,
  names: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length)),
  );
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data: existing, error } = await client
    .from("horses")
    .select("id, name")
    .in("name", unique);
  if (error) throw error;
  for (const h of existing ?? []) {
    map.set(h.name as string, h.id as string);
  }

  const missing = unique.filter((n) => !map.has(n));
  if (missing.length) {
    const payload = missing.map((name, idx) => ({
      name,
      name_kana: name,
      is_supportable: true,
      sort_order: 100 + idx,
      profile: "管理データー【管理厳重】.xlsx から自動登録",
    }));
    const { data: inserted, error: insErr } = await client
      .from("horses")
      .insert(payload)
      .select("id, name");
    if (insErr) throw insErr;
    for (const h of inserted ?? []) {
      map.set(h.name as string, h.id as string);
    }
  }
  return map;
}

async function main() {
  const filePath = findXlsx(path.join(process.cwd(), "docs"));
  if (!filePath) throw new Error("No .xlsx under ./docs");
  console.log("[seed] reading", filePath);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role credentials missing");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<any[]>(ws, {
    defval: null,
    header: 1,
    blankrows: false,
  });

  const parsed: Row[] = rawRows.slice(1).map(parseRow).filter((r) => r.email);
  console.log(`[seed] parsed ${parsed.length} rows with email`);

  // Group by email
  const byEmail = new Map<string, Row[]>();
  for (const r of parsed) {
    const email = normaliseEmail(r.email);
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push(r);
    byEmail.set(email, list);
  }
  console.log(`[seed] ${byEmail.size} unique customers`);

  const plans = await ensurePlans(client);

  const allHorseNames: string[] = [];
  for (const rows of byEmail.values()) {
    for (const r of rows) if (r.horseName) allHorseNames.push(r.horseName);
  }
  const horseIdByName = await ensureHorses(client, allHorseNames);
  console.log(`[seed] horses ensured: ${horseIdByName.size}`);

  const rand = mulberry32(20260417);

  let customerCount = 0;
  let contractCount = 0;
  let supportCount = 0;
  let paymentCount = 0;
  let donationCount = 0;

  const customerIds: string[] = [];

  for (const [email, rows] of byEmail.entries()) {
    const primary = rows[0];
    const fullName = primary.fullName ?? email.split("@")[0];
    const postal = rows.find((r) => r.postalCode)?.postalCode ?? null;
    const address = rows.find((r) => r.address)?.address ?? null;
    const phone = null; // spreadsheet doesn't reliably carry phone numbers
    const status = pickStatus(primary, rand);

    const { data: existing } = await client
      .from("customers")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    let customerId: string;
    if (existing?.id) {
      customerId = existing.id as string;
      await client
        .from("customers")
        .update({
          full_name: fullName,
          full_name_kana: primary.nickname ?? null,
          phone,
          postal_code: postal,
          address1: address,
          status,
        })
        .eq("id", customerId);
    } else {
      const { data: created, error: insErr } = await client
        .from("customers")
        .insert({
          email,
          full_name: fullName,
          full_name_kana: primary.nickname ?? null,
          phone,
          postal_code: postal,
          address1: address,
          status,
        })
        .select("id")
        .single();
      if (insErr) {
        console.error(`customer insert failed for ${email}:`, insErr.message);
        continue;
      }
      customerId = (created as any).id as string;
      customerCount++;
    }
    customerIds.push(customerId);

    // ---- Membership plan contract (derived from first meaningful rank) ----
    const planRow = rows.find((r) => r.rank) ?? primary;
    const planKey = rankToPlan(planRow.rank);
    const contractStatus = pickContractStatus(rand);
    let mainContractId: string | null = null;

    if (planKey) {
      const plan = plans.get(`${planKey.code}:${planKey.name}`);
      if (plan) {
        const { data: existingContract } = await client
          .from("contracts")
          .select("id")
          .eq("customer_id", customerId)
          .eq("plan_id", plan.id)
          .maybeSingle();
        if (existingContract?.id) {
          mainContractId = existingContract.id as string;
        } else {
          const started =
            planRow.contractDate ??
            new Date(Date.now() - Math.floor(rand() * 400) * 86400_000);
          const nextPayment = new Date(
            Date.now() + Math.floor(5 + rand() * 30) * 86400_000,
          );
          const { data: ctr, error: ctErr } = await client
            .from("contracts")
            .insert({
              customer_id: customerId,
              plan_id: plan.id,
              status: contractStatus,
              started_at: started.toISOString(),
              current_period_end: nextPayment.toISOString(),
            })
            .select("id")
            .single();
          if (!ctErr && ctr) {
            mainContractId = (ctr as any).id as string;
            contractCount++;
          }
        }
      }
    }

    // ---- Support subscriptions (per horse row) ----
    const supportRows = rows.filter((r) => r.horseName);
    if (supportRows.length > 0) {
      const supportPlan =
        plans.get("SUPPORT:1口支援") ?? plans.get("SUPPORT:半口支援");
      if (!mainContractId && supportPlan) {
        const started =
          supportRows[0].contractDate ??
          new Date(Date.now() - Math.floor(rand() * 400) * 86400_000);
        const { data: ctr } = await client
          .from("contracts")
          .insert({
            customer_id: customerId,
            plan_id: supportPlan.id,
            status: contractStatus,
            started_at: started.toISOString(),
            current_period_end: new Date(
              Date.now() + Math.floor(5 + rand() * 30) * 86400_000,
            ).toISOString(),
          })
          .select("id")
          .single();
        if (ctr) {
          mainContractId = (ctr as any).id as string;
          contractCount++;
        }
      }

      for (const sr of supportRows) {
        if (!sr.horseName) continue;
        const horseId = horseIdByName.get(sr.horseName);
        if (!horseId) continue;
        const units = sr.units ?? (/半口/.test(sr.rank ?? "") ? 0.5 : 1);
        // The half-share is already expressed by units (0.5). Charge is a
        // single per-口 rate (1口 = 12,000円) scaled by units, so 半口 = 6,000円.
        // NOTE: do NOT use the 半口 plan's unit_amount (6,000) here and then
        // multiply by 0.5 — that double-discounts to 3,000 ("half of half").
        const fullUnitPlan =
          plans.get("SUPPORT:1口支援") ?? plans.get("SUPPORT:1口支援馬会員");
        const perUnit = fullUnitPlan?.unit_amount ?? 12000;
        const monthly = Math.round(perUnit * units);

        const { data: existingSupport } = await client
          .from("support_subscriptions")
          .select("id")
          .eq("customer_id", customerId)
          .eq("horse_id", horseId)
          .maybeSingle();
        if (existingSupport?.id) continue;

        if (!mainContractId) continue;
        const { error: supErr } = await client
          .from("support_subscriptions")
          .insert({
            contract_id: mainContractId,
            customer_id: customerId,
            horse_id: horseId,
            units,
            monthly_amount: monthly,
            status: contractStatus,
            started_at:
              sr.contractDate?.toISOString() ?? new Date().toISOString(),
          });
        if (supErr) {
          console.error(
            `support insert for ${email} / ${sr.horseName}:`,
            supErr.message,
          );
        } else {
          supportCount++;
        }
      }
    }

    // ---- Synthetic payments on the main contract ----
    if (mainContractId) {
      const { count } = await client
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("contract_id", mainContractId);
      if ((count ?? 0) === 0) {
        const cycles = 1 + Math.floor(rand() * 4);
        for (let i = 0; i < cycles; i++) {
          const occurred = new Date(
            Date.now() - (i * 30 + Math.floor(rand() * 10)) * 86400_000,
          );
          const failed = rand() < 0.08;
          const { error: payErr } = await client.from("payments").insert({
            customer_id: customerId,
            contract_id: mainContractId,
            kind: "subscription",
            amount: 1000 + Math.floor(rand() * 12) * 500,
            status: failed ? "failed" : "succeeded",
            occurred_at: occurred.toISOString(),
            failure_reason: failed ? "card_declined" : null,
          });
          if (!payErr) paymentCount++;
        }
      }
    }

    // ---- Random donations for ~15% of customers ----
    if (rand() < 0.15) {
      const amt = [1000, 3000, 5000, 10000, 30000][Math.floor(rand() * 5)];
      const occurred = new Date(
        Date.now() - Math.floor(rand() * 180) * 86400_000,
      );
      const { data: d, error: dErr } = await client
        .from("donations")
        .insert({
          customer_id: customerId,
          donor_name: fullName,
          donor_email: email,
          amount: amt,
          status: "succeeded",
          donated_at: occurred.toISOString(),
        })
        .select("id")
        .single();
      if (!dErr && d) {
        donationCount++;
        await client.from("payments").insert({
          customer_id: customerId,
          donation_id: (d as any).id,
          kind: "donation",
          amount: amt,
          status: "succeeded",
          occurred_at: occurred.toISOString(),
        });
        paymentCount++;
      }
    }
  }

  // ---- Random bookings against existing events ----
  const { data: events } = await client
    .from("events")
    .select("id, capacity, supporters_only")
    .eq("is_published", true);
  if (events && events.length > 0) {
    // Pick 40 random customers and give them a booking each if not booked already.
    const sample = customerIds
      .slice()
      .sort(() => rand() - 0.5)
      .slice(0, Math.min(40, customerIds.length));
    for (const cid of sample) {
      const ev = events[Math.floor(rand() * events.length)] as any;
      const { data: existing } = await client
        .from("bookings")
        .select("id")
        .eq("customer_id", cid)
        .eq("event_id", ev.id)
        .maybeSingle();
      if (existing?.id) continue;
      await client.from("bookings").insert({
        customer_id: cid,
        event_id: ev.id,
        party_size: 1 + Math.floor(rand() * 3),
        status: rand() < 0.9 ? "reserved" : "canceled",
      });
    }
  }

  console.log(`\n[seed] done.
  customers created:          ${customerCount}
  contracts created:          ${contractCount}
  support subscriptions:      ${supportCount}
  payments created:           ${paymentCount}
  donations created:          ${donationCount}
  horses in catalog:          ${horseIdByName.size}
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
