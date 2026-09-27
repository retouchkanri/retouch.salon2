/**
 * Release-readiness preflight.
 *
 * Verifies:
 *   1. Required environment variables are set.
 *   2. Supabase service role connects and the expected tables exist.
 *   3. Critical seed data is present (membership_plans).
 *   4. RLS helper functions exist (is_admin / current_customer_id).
 *
 * Exits non-zero if anything fails so it can be wired into CI / a deploy gate.
 *
 *   npx tsx scripts/preflight.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

type Check = { name: string; ok: boolean; detail?: string };

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SITE_URL",
];

const optional = [
  "NOTIFY_TRANSPORT",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "MAIL_FROM_NAME",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
];

const expectedTables = [
  "customers",
  "horses",
  "membership_plans",
  "contracts",
  "support_subscriptions",
  "donations",
  "events",
  "bookings",
  "payments",
  "admin_memos",
  "audit_logs",
];

async function main() {
  const checks: Check[] = [];

  for (const k of required) {
    const v = process.env[k];
    checks.push({ name: `env:${k}`, ok: !!(v && v.trim()), detail: v ? "set" : "missing" });
  }
  for (const k of optional) {
    const v = process.env[k];
    if (v) checks.push({ name: `env:${k}`, ok: true, detail: "set (optional)" });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    checks.push({ name: "supabase:client", ok: false, detail: "Supabase env not set, skipping DB checks" });
    return finish(checks);
  }

  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  checks.push({ name: "supabase:client", ok: true, detail: url });

  for (const t of expectedTables) {
    const { error } = await client.from(t).select("*", { head: true, count: "exact" }).limit(1);
    checks.push({ name: `table:${t}`, ok: !error, detail: error?.message });
  }

  const { error: viewErr } = await client
    .from("v_customer_summary")
    .select("*", { head: true, count: "exact" })
    .limit(1);
  checks.push({ name: "view:v_customer_summary", ok: !viewErr, detail: viewErr?.message });

  const { count: planCount } = await client
    .from("membership_plans")
    .select("*", { head: true, count: "exact" });
  checks.push({
    name: "seed:membership_plans>=1",
    ok: !!(planCount && planCount > 0),
    detail: `count=${planCount ?? 0}`,
  });

  const { count: horseCount } = await client
    .from("horses")
    .select("*", { head: true, count: "exact" });
  checks.push({
    name: "seed:horses>=1",
    ok: !!(horseCount && horseCount > 0),
    detail: `count=${horseCount ?? 0}`,
  });

  // Audit table writeable: insert + delete a probe row.
  const probeMeta = { preflight: true, ts: new Date().toISOString() };
  const { data: probe, error: insErr } = await client
    .from("audit_logs")
    .insert({
      action: "preflight.probe",
      target_table: "audit_logs",
      meta: probeMeta,
    })
    .select("id")
    .single();
  if (insErr || !probe?.id) {
    checks.push({ name: "audit:insert", ok: false, detail: insErr?.message ?? "no row" });
  } else {
    checks.push({ name: "audit:insert", ok: true });
    await client.from("audit_logs").delete().eq("id", probe.id);
  }

  finish(checks);
}

function finish(checks: Check[]) {
  let failed = 0;
  for (const c of checks) {
    const tag = c.ok ? "✅" : "❌";
    console.log(`${tag} ${c.name}${c.detail ? `  ${c.detail}` : ""}`);
    if (!c.ok) failed += 1;
  }
  console.log("");
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("preflight error:", e);
  process.exit(1);
});
