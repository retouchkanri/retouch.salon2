#!/usr/bin/env node
/**
 * READ-ONLY inspection of the live pricing data. Modifies nothing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const content = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. membership_plans
const { data: plans, error: pErr } = await sb
  .from('membership_plans')
  .select('id, code, name, monthly_amount, unit_amount, is_active, sort_order')
  .order('sort_order');
if (pErr) { console.error('plans error', pErr); process.exit(1); }
console.log('=== membership_plans ===');
for (const p of plans) {
  console.log(`  code=${(p.code||'').padEnd(13)} name=${(p.name||'').padEnd(14)} monthly=${String(p.monthly_amount).padStart(6)} unit=${String(p.unit_amount).padStart(6)} active=${p.is_active}`);
}

// 2. support_subscriptions: units vs monthly_amount distribution
const { data: subs, error: sErr } = await sb
  .from('support_subscriptions')
  .select('id, units, monthly_amount, status');
if (sErr) { console.error('support error', sErr); process.exit(1); }
console.log(`\n=== support_subscriptions (total ${subs.length}) ===`);
const dist = {};
for (const s of subs) {
  const k = `units=${s.units} | monthly=${s.monthly_amount} | status=${s.status}`;
  dist[k] = (dist[k] || 0) + 1;
}
for (const [k, v] of Object.entries(dist).sort()) console.log(`  ${k}  x${v}`);

// Anomaly summary: rows where monthly != 12000*units (the intended per-口 price)
console.log('\n--- rows where monthly_amount != 12000 * units (active/past_due only) ---');
let bad = 0, totalDiff = 0;
for (const s of subs) {
  if (!['active', 'past_due'].includes(s.status)) continue;
  const expected = Math.round(12000 * Number(s.units));
  if (s.monthly_amount !== expected) {
    bad++;
    totalDiff += expected - s.monthly_amount;
  }
}
console.log(`  count=${bad}, total under-charge if fixed to 12000*units = ${totalDiff} yen/month`);

// 3. Special team
const { data: team } = await sb
  .from('special_team_memberships')
  .select('monthly_amount, status');
const tdist = {};
for (const t of team || []) { const k = `monthly=${t.monthly_amount}|${t.status}`; tdist[k] = (tdist[k]||0)+1; }
console.log('\n=== special_team_memberships ===');
for (const [k, v] of Object.entries(tdist).sort()) console.log(`  ${k}  x${v}`);

// 4. Focus customer
console.log('\n=== focus: lovelycatnanafumi@gmail.com ===');
const { data: cust } = await sb.from('customers').select('id, full_name, email').eq('email', 'lovelycatnanafumi@gmail.com').maybeSingle();
if (!cust) { console.log('  customer not found'); }
else {
  console.log(`  ${cust.full_name} (${cust.id})`);
  const { data: fs2 } = await sb
    .from('support_subscriptions')
    .select('id, units, monthly_amount, status, horse:horses(name)')
    .eq('customer_id', cust.id);
  let total = 0;
  for (const s of fs2 || []) {
    if (['active','past_due'].includes(s.status)) total += s.monthly_amount;
    console.log(`    horse=${(s.horse?.name||'-').padEnd(10)} units=${s.units} monthly=${s.monthly_amount} status=${s.status}`);
  }
  const { data: ctrs } = await sb
    .from('contracts')
    .select('id, status, plan:membership_plans(code, name, monthly_amount)')
    .eq('customer_id', cust.id);
  for (const c of ctrs || []) {
    console.log(`    [contract] plan=${c.plan?.name} code=${c.plan?.code} monthly=${c.plan?.monthly_amount} status=${c.status}`);
  }
  console.log(`    SUPPORT total (active) = ${total}`);
}
