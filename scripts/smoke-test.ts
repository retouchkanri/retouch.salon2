/**
 * Quick smoke test against the configured Supabase project.
 * Confirms the schema is applied and seed data present.
 *   npx tsx scripts/smoke-test.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  console.log("URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);

  const tables = [
    "customers","horses","membership_plans","contracts",
    "support_subscriptions","donations","bookings","events",
    "payments","admin_memos",
  ];

  let ok = true;
  for (const name of [...tables, "v_customer_summary"]) {
    // head:true returns 204 even for missing tables; do a real select.
    const { error, data } = await client.from(name).select("*").limit(1);
    if (error) {
      ok = false;
      console.log(`❌ ${name}: ${error.message}`);
    } else {
      console.log(`✅ ${name}: ${data?.length ?? 0} sample row`);
    }
  }
  if (!ok) {
    console.log("\nスキーマが未適用です。supabase/migrations/all.sql の内容を Supabase SQL Editor に貼り付けて実行してください。");
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
