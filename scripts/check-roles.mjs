// READ-ONLY: prints profiles.role for the staff accounts + a role tally.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAILS = ["bagunet21@yahoo.co.jp", "admin@gmail.com", "horse@gamil.com"];

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

console.log("project:", url);
for (const email of EMAILS) {
  const uid = await findUserId(email);
  if (!uid) { console.log(`${email.padEnd(26)} : no auth user`); continue; }
  const { data: prof } = await sb.from("profiles").select("role, customer_id").eq("id", uid).maybeSingle();
  console.log(`${email.padEnd(26)} : uid=${uid} role=${prof?.role ?? "(no profile row)"} customer=${prof?.customer_id ?? "—"}`);
}

const { data: all } = await sb.from("profiles").select("role");
const tally = {};
for (const r of all ?? []) tally[r.role] = (tally[r.role] ?? 0) + 1;
console.log("role tally:", tally);
process.exit(0);
