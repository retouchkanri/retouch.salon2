// Assigns owner/admin/moderator to the three bootstrap accounts by upserting
// public.profiles.role. Data-only (no DDL); preserves passwords and any
// existing customer_id link. Idempotent.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ASSIGNMENTS = [
  ["bagunet21@yahoo.co.jp", "owner"],
  ["admin@gmail.com", "admin"],
  ["horse@gamil.com", "moderator"],
];

async function findUserId(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function main() {
  for (const [email, role] of ASSIGNMENTS) {
    const uid = await findUserId(email);
    if (!uid) {
      console.log(`skip  ${email}: no auth user found`);
      continue;
    }
    const { data: cust } = await sb.from("customers").select("id").eq("email", email).maybeSingle();
    const row = { id: uid, role };
    if (cust?.id) row.customer_id = cust.id;
    const { error } = await sb.from("profiles").upsert(row, { onConflict: "id" });
    if (error) {
      console.error(`FAIL  ${email}: ${error.message}`);
      continue;
    }
    console.log(`ok    ${email} -> ${role}  (uid=${uid}, customer=${cust?.id ?? "none"})`);
  }

  console.log("\n-- verify --");
  for (const [email] of ASSIGNMENTS) {
    const uid = await findUserId(email);
    if (!uid) continue;
    const { data } = await sb.from("profiles").select("role, customer_id").eq("id", uid).maybeSingle();
    console.log(`${email.padEnd(26)} role=${data?.role ?? "(no profile row)"}`);
  }
}

main().then(() => process.exit(0));
