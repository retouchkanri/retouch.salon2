// Confirms whether admin RLS reads of base tables work. Signs in as admin via
// the ANON key (exactly like the browser) and counts customers/contracts.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMAIL = "admin@gmail.com";
const PASSWORD = process.argv[2] ?? "admin@gmail.com";

const asUser = createClient(url, anon, { auth: { persistSession: false } });
const { error: signErr } = await asUser.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signErr) { console.log("signIn failed:", signErr.message); process.exit(0); }

async function countAs(label, client, table, filter) {
  let q = client.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  console.log(`${label} ${table.padEnd(22)} count=${count ?? "null"}${error ? `  ERROR: ${error.message}` : ""}`);
}

console.log("== as admin user (anon key + RLS) ==");
await countAs("[user]", asUser, "customers");
await countAs("[user]", asUser, "contracts");
await countAs("[user]", asUser, "payments");
await countAs("[user]", asUser, "bookings");
// is_admin() path: reading another user's profile row requires is_admin()=true
const { data: pAll, error: pErr } = await asUser.from("profiles").select("id, role");
console.log(`[user] profiles visible rows=${pAll?.length ?? "null"}${pErr ? `  ERROR: ${pErr.message}` : ""}`);

console.log("\n== as service role (ground truth) ==");
const svc = createClient(url, service, { auth: { persistSession: false } });
await countAs("[svc ]", svc, "customers");
await countAs("[svc ]", svc, "contracts");
await countAs("[svc ]", svc, "payments");

await asUser.auth.signOut();
process.exit(0);
