// Deactivates empty duplicate membership_plans (requirement #5): an active plan
// with 0 contracts that has a same-code sibling WITH contracts. Keeps linked
// plans active; never deletes. Idempotent. Mirrors
// migrations/20260601_deactivate_duplicate_plans.sql.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: plans } = await sb.from("membership_plans").select("id, code, name, is_active");
const { data: contracts } = await sb.from("contracts").select("plan_id");

const contractCount = new Map();
for (const c of contracts ?? []) {
  if (c.plan_id) contractCount.set(c.plan_id, (contractCount.get(c.plan_id) ?? 0) + 1);
}
const codeHasLinkedSibling = (code, selfId) =>
  (plans ?? []).some((p) => p.code === code && p.id !== selfId && (contractCount.get(p.id) ?? 0) > 0);

const toDeactivate = (plans ?? []).filter(
  (p) => p.is_active && (contractCount.get(p.id) ?? 0) === 0 && codeHasLinkedSibling(p.code, p.id),
);

if (!toDeactivate.length) {
  console.log("No empty duplicate plans to deactivate.");
  process.exit(0);
}

console.log("Deactivating empty duplicate plans (0 contracts, has linked sibling):");
for (const p of toDeactivate) console.log(`  [${p.code}] "${p.name}"  id=${p.id}`);

const ids = toDeactivate.map((p) => p.id);
const { error } = await sb.from("membership_plans").update({ is_active: false }).in("id", ids);
if (error) {
  console.error("FAILED:", error.message);
  process.exit(1);
}

console.log("\n-- result (active plans by code) --");
const { data: after } = await sb
  .from("membership_plans")
  .select("code, name, is_active")
  .order("code");
for (const p of after ?? []) {
  console.log(`  ${p.is_active ? "[有効]" : "[無効]"} ${p.code.padEnd(13)} ${p.name}`);
}
process.exit(0);
