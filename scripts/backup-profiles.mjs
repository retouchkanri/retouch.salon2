#!/usr/bin/env node
/**
 * READ-ONLY backup of the profiles table (with joined customer email/name)
 * to backups/profiles_<timestamp>.json. Run this before applying the
 * six-role migration so the previous role of every account is recoverable.
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

const { data: profiles, error } = await sb
  .from("profiles")
  .select("id, role, customer_id, created_at, updated_at, customers(email, full_name)")
  .order("created_at", { ascending: true });
if (error) {
  console.error("Backup failed:", error.message);
  process.exit(1);
}

const flat = (profiles ?? []).map((p) => ({
  id: p.id,
  role: p.role,
  customer_id: p.customer_id,
  email: p.customers?.email ?? null,
  full_name: p.customers?.full_name ?? null,
  created_at: p.created_at,
  updated_at: p.updated_at,
}));

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.resolve(__dirname, "../backups");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `profiles_${stamp}.json`);
fs.writeFileSync(file, JSON.stringify(flat, null, 2), "utf8");

console.log(`Backed up ${flat.length} profiles → ${path.relative(path.resolve(__dirname, ".."), file)}`);
