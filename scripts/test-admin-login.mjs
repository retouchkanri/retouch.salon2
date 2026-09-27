// NON-DESTRUCTIVE login test: replicates AdminLoginForm exactly using the ANON
// key (same as the browser) — sign in, read own profile under RLS, check staff.
// Tries the seed-convention password (== email) unless one is passed as argv[2].
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const EMAIL = "admin@gmail.com";
const PASSWORD = process.argv[2] ?? "admin@gmail.com";

const STAFF = new Set(["owner", "admin", "moderator"]);

const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (error || !data.user) {
  console.log(`signIn FAILED for ${EMAIL} (password tried: "${PASSWORD}") -> ${error?.message ?? "no user"}`);
  console.log("=> If the password differs, the block is the PASSWORD, not the role.");
  process.exit(0);
}
console.log(`signIn OK: uid=${data.user.id}`);

// Same query AdminLoginForm / getSession run, under the user's RLS session:
const { data: profile, error: pErr } = await sb
  .from("profiles")
  .select("role, customer_id")
  .eq("id", data.user.id)
  .maybeSingle();

console.log("profile read (RLS as user):", profile ?? "(null)", pErr ? `error=${pErr.message}` : "");
const actual = profile?.role ?? "(null -> toRole would give 'member')";
console.log(`actual role = ${actual}`);
console.log(`isStaff = ${STAFF.has(profile?.role)} -> ${STAFF.has(profile?.role) ? "redirects to /admin" : "FORBIDDEN"}`);

await sb.auth.signOut();
process.exit(0);
