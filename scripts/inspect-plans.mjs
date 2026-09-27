// READ-ONLY: lists membership_plans with contract linkage, to identify
// duplicate/old plans (requirement #5 cleanup).
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: plans } = await sb
  .from("membership_plans")
  .select("id, code, name, monthly_amount, unit_amount, is_active, sort_order")
  .order("code")
  .order("sort_order");

// contracts → plan_id linkage count (active + total)
const { data: contracts } = await sb.from("contracts").select("plan_id, status");
const byPlan = new Map();
for (const c of contracts ?? []) {
  if (!c.plan_id) continue;
  const cur = byPlan.get(c.plan_id) ?? { total: 0, active: 0 };
  cur.total += 1;
  if (c.status === "active" || c.status === "past_due") cur.active += 1;
  byPlan.set(c.plan_id, cur);
}

console.log(`membership_plans: ${plans?.length ?? 0} rows\n`);
const byCode = {};
for (const p of plans ?? []) (byCode[p.code] ??= []).push(p);

for (const code of Object.keys(byCode)) {
  const rows = byCode[code];
  console.log(`== code ${code} (${rows.length} row${rows.length > 1 ? "s — DUPLICATE" : ""}) ==`);
  for (const p of rows) {
    const link = byPlan.get(p.id) ?? { total: 0, active: 0 };
    console.log(
      `  ${p.is_active ? "[有効]" : "[無効]"} "${p.name}"  ¥${p.monthly_amount}` +
        `  contracts: ${link.total} (active ${link.active})  id=${p.id}`,
    );
  }
}
process.exit(0);
