#!/usr/bin/env node
/**
 * READ-ONLY dry-run of the six-role migration (supabase/migrations/20260529_six_roles.sql).
 * Computes — without writing anything — what each profile's role WOULD become,
 * and prints a before→after summary plus the individual accounts that change.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
for (const line of env.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// RPT plan id(s)
const { data: rptPlans } = await sb.from("membership_plans").select("id").eq("code", "RPT");
const rptPlanIds = new Set((rptPlans ?? []).map((p) => p.id));

// Customers holding an RPT contract.
const rptCustomers = new Set();
if (rptPlanIds.size) {
  const { data: rptRows } = await sb
    .from("contracts")
    .select("customer_id, plan_id")
    .in("plan_id", Array.from(rptPlanIds));
  for (const r of rptRows ?? []) rptCustomers.add(r.customer_id);
}

const { data: profiles } = await sb
  .from("profiles")
  .select("id, role, customer_id, customers(email, full_name)")
  .order("created_at", { ascending: true });

function nextRole(p) {
  const email = (p.customers?.email ?? "").toLowerCase();
  if (email === "bagunet21@yahoo.co.jp") return "owner"; // 野口 佳槻
  if (email === "admin@gmail.com") return "admin"; // sole administrator
  if (email === "horse@gamil.com") return "moderator"; // seeded moderator
  if (p.role === "staff") return "moderator";
  if ((p.role === "member" || p.role === "user") && rptCustomers.has(p.customer_id)) {
    return "honorary_member";
  }
  return p.role; // unchanged (admin stays admin, member stays member, etc.)
}

const before = {};
const after = {};
const changes = [];
for (const p of profiles ?? []) {
  const from = p.role;
  const to = nextRole(p);
  before[from] = (before[from] ?? 0) + 1;
  after[to] = (after[to] ?? 0) + 1;
  if (from !== to) {
    changes.push({ email: p.customers?.email ?? "(no email)", name: p.customers?.full_name ?? "", from, to });
  }
}

console.log("=== Role distribution BEFORE ===");
console.table(before);
console.log("=== Role distribution AFTER (planned) ===");
console.table(after);
console.log(`\n=== Accounts that change (${changes.length}) ===`);
for (const c of changes) {
  console.log(`${c.from.padEnd(8)} → ${c.to.padEnd(16)} ${c.email}  ${c.name}`);
}
console.log(`\nRPT customers detected: ${rptCustomers.size}`);
console.log("\nThis was a DRY RUN — nothing was written.");
