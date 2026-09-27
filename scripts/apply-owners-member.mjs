import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function runFile(relativePath) {
  const sql = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const { error } = await sb.rpc("exec_sql", { query: sql });
  if (error) throw new Error(`${relativePath}: ${error.message}`);
  console.log(`Applied ${relativePath}`);
}

async function main() {
  try {
    await runFile("../supabase/migrations/20260615_owners_member_enum.sql");
    await runFile("../supabase/migrations/20260615_owners_member_plan.sql");
  } catch (e) {
    console.error(String(e));
    console.error(
      "\nPlease run these files in Supabase Dashboard → SQL Editor (in order):\n" +
        "  1. supabase/migrations/20260615_owners_member_enum.sql\n" +
        "  2. supabase/migrations/20260615_owners_member_plan.sql",
    );
    process.exit(1);
  }

  const { data: plan } = await sb
    .from("membership_plans")
    .select("id, code, name, monthly_amount")
    .eq("code", "OWNER")
    .eq("name", "オーナーズ会員")
    .maybeSingle();
  if (!plan) {
    console.error("OWNER plan not found after migration");
    process.exit(1);
  }
  console.log("OWNER plan OK:", plan);
}

main();
