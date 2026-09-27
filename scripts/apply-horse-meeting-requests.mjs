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
  new URL("../supabase/migrations/20260614_horse_meeting_requests.sql", import.meta.url),
  "utf8",
);

const { error } = await sb.rpc("exec_sql", { query: sql });
if (error) {
  console.error("Apply FAILED:", error.message);
  process.exit(1);
}
console.log("Applied 20260614_horse_meeting_requests.sql");

const { error: probe } = await sb.from("horse_meeting_requests").select("id").limit(1);
if (probe) {
  console.error("Table probe failed:", probe.message);
  process.exit(1);
}
console.log("horse_meeting_requests table OK");
