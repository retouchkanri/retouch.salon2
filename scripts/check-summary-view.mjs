// READ-ONLY: verifies v_customer_summary exposes the member-classification
// columns (member_class_code, total_support_units/horses) on the live DB.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await sb
  .from("v_customer_summary")
  .select("customer_id, member_class_code, total_support_units, total_support_horses, rpt_active, special_team_count, special_team_names")
  .or("rpt_active.eq.true,special_team_count.gt.0,member_class_code.eq.SUPPORT")
  .limit(8);

if (error) {
  console.log("VIEW QUERY ERROR:", error.message);
  console.log("=> The member_classification migration is NOT applied to this DB.");
  process.exit(0);
}
console.log("v_customer_summary sample rows:");
for (const r of data ?? []) console.log(r);
console.log(`\nmember_class_code present: ${data?.[0] ? "member_class_code" in data[0] : "n/a"}`);
process.exit(0);
