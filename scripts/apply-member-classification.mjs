// Applies supabase/migrations/20260601_member_classification.sql to the
// database in .env.local. DDL is additive/non-destructive:
//   - add column if not exists special_team_memberships.team_name
//   - create or replace view v_customer_summary
// Requires an `exec_sql(query text)` RPC in the database. If that RPC is not
// present, the script prints instructions to run the SQL in the Supabase
// Dashboard SQL Editor instead.
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

const sql = readFileSync(
  new URL("../supabase/migrations/20260601_member_classification.sql", import.meta.url),
  "utf8",
);

const probe = process.argv.includes("--probe");

async function main() {
  if (probe) {
    const { error } = await sb.rpc("exec_sql", { query: "select 1;" });
    if (error) {
      console.log("exec_sql RPC NOT available:", error.message);
      process.exit(2);
    }
    console.log("exec_sql RPC is available.");
    return;
  }

  const { error } = await sb.rpc("exec_sql", { query: sql });
  if (error) {
    console.error("Apply FAILED via exec_sql:", error.message);
    console.error(
      "\nPlease run this file in the Supabase Dashboard → SQL Editor instead:\n" +
        "  supabase/migrations/20260601_member_classification.sql",
    );
    process.exit(1);
  }
  console.log("✅ Applied 20260601_member_classification.sql");
}

main();
