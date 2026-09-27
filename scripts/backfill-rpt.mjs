#!/usr/bin/env node
/**
 * Backfill the 20 existing RetouchPony【リタポ】メンバー (RPT) customers.
 *
 * - Ensures the RPT membership_plans row exists (¥3,000/month, combinable).
 * - For each member: find-or-create the customer (by lowercased email) and
 *   create an RPT contract (status=active) if one does not already exist.
 * - DB-only: does NOT create or touch Stripe (these members already have
 *   live Stripe contracts; the rest of this DB carries no Stripe linkage).
 *
 * Idempotent: safe to re-run. Requires the 'RPT' enum value to exist
 * (see migration applied separately).
 *
 * Usage:
 *   node scripts/backfill-rpt.mjs --dry     # preview, no writes
 *   node scripts/backfill-rpt.mjs           # apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');

const content = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
for (const line of content.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PLAN = {
  code: 'RPT',
  name: 'RetouchPony【リタポ】メンバー',
  monthly_amount: 3000,
  unit_amount: null,
  allow_with_support: true,
  allow_with_team: true,
  is_active: true,
  sort_order: 45,
  description: '月額3,000円のRetouch Ponys Team（RPT）メンバー（他会員と併用可能）',
};

// 20 members from the client's list. started = registration date in the list.
// statusRaw is the raw status word shown; all are recorded as active members
// (see report note about the "有効期限" rows).
const MEMBERS = [
  { email: 'luckyusagi09@gmail.com', name: '伊出 美恵', started: '2026-04-14', statusRaw: '有効' },
  { email: 'aki060901@yahoo.co.jp', name: '宮崎 早苗', started: '2026-04-07', statusRaw: '有効' },
  { email: 'yoko405e@ybb.ne.jp', name: '遠藤 陽子', started: '2026-04-07', statusRaw: '有効' },
  { email: 'yoko@namc.co.jp', name: '影山 陽子', started: '2026-04-12', statusRaw: '有効' },
  { email: 'rei0470@gmail.com', name: '宮原玲子', started: '2026-04-13', statusRaw: '有効' },
  { email: 'tcqmw191@yahoo.co.jp', name: '牧志 敏夫', started: '2026-04-12', statusRaw: '有効期限' },
  { email: 'kiirotennis@icloud.com', name: '坂尾 貴子', started: '2026-04-06', statusRaw: '有効期限' },
  { email: 'tymnnf_aaawss_@i.softbank.jp', name: '石田 成美', started: '2026-04-06', statusRaw: '有効期限' },
  { email: 'tomoka.kyt.4wt22@ezweb.ne.jp', name: '高橋 智香', started: '2026-04-13', statusRaw: '有効' },
  { email: 'melody.takeda.0909@docomo.ne.jp', name: '武田 真美', started: '2026-05-03', statusRaw: '有効' },
  { email: 'kyoko320ku@icloud.com', name: '上田京子', started: '2026-04-15', statusRaw: '有効' },
  { email: 'asahi1351kiki@gmail.com', name: '大田佳代子', started: '2026-05-08', statusRaw: '有効期限' },
  { email: 'tomoko683467@docomo.ne.jp', name: '溝口 智子', started: '2026-04-06', statusRaw: '有効' },
  { email: 'choco-momo-sumomo@h.vodafone.ne.jp', name: '鈴木睦子', started: '2026-04-08', statusRaw: '有効期限' },
  { email: 'loveciao2525@gmail.com', name: '西村美穂', started: '2026-04-08', statusRaw: '有効' },
  { email: '1999116.y@gmail.com', name: '渡辺由美子', started: '2026-04-21', statusRaw: '有効' },
  { email: 'tamawayoga@gmail.com', name: '須田 玉治', started: '2026-04-12', statusRaw: '有効' },
  { email: 'ku-tan.108@docomo.ne.jp', name: '中村陽子', started: '2026-04-11', statusRaw: '有効' },
  { email: 'ammmaaa.ya@ezweb.ne.jp', name: '柳田 亜沙美', started: '2022-02-13', statusRaw: '有効' },
  { email: 'cha_ko-akemi@au.com', name: '大原 亜香美', started: '2026-05-04', statusRaw: '有効' },
];

console.log(`Mode: ${DRY ? 'DRY-RUN (no writes)' : 'APPLY'}\n`);

// 1. Ensure RPT plan
let { data: plan } = await sb
  .from('membership_plans')
  .select('id, code, name, monthly_amount')
  .eq('code', 'RPT')
  .eq('name', PLAN.name)
  .maybeSingle();

if (plan) {
  console.log(`RPT plan exists: ${plan.id} (¥${plan.monthly_amount})`);
} else if (DRY) {
  console.log('RPT plan would be CREATED.');
} else {
  const { data: created, error } = await sb.from('membership_plans').insert(PLAN).select('id, monthly_amount').single();
  if (error) { console.error('FAILED to create RPT plan:', error.message); process.exit(1); }
  plan = created;
  console.log(`RPT plan CREATED: ${plan.id} (¥${plan.monthly_amount})`);
}
const planId = plan?.id ?? '(dry)';

// 2. Backfill members
let createdCustomers = 0, createdContracts = 0, skippedContracts = 0, missingPlanAbort = 0;
const newlyCreated = [];
for (const m of MEMBERS) {
  const email = m.email.trim().toLowerCase();

  // find-or-create customer
  let { data: cust } = await sb.from('customers').select('id, full_name').eq('email', email).maybeSingle();
  if (!cust) {
    if (DRY) {
      console.log(`  [would create customer] ${email} (${m.name})`);
      newlyCreated.push(email);
    } else {
      const { data: ins, error } = await sb
        .from('customers')
        .insert({ email, full_name: m.name, status: 'active' })
        .select('id, full_name')
        .single();
      if (error) { console.error(`  customer create FAILED ${email}: ${error.message}`); continue; }
      cust = ins;
      createdCustomers++;
      newlyCreated.push(email);
    }
  }
  const customerId = cust?.id ?? '(dry)';

  if (DRY) {
    if (plan) {
      const { data: existing } = await sb
        .from('contracts')
        .select('id')
        .eq('customer_id', customerId)
        .eq('plan_id', planId)
        .in('status', ['active', 'past_due', 'paused', 'incomplete'])
        .maybeSingle();
      console.log(`  ${email.padEnd(34)} ${existing ? 'contract EXISTS (skip)' : 'contract would be CREATED'}`);
    } else {
      console.log(`  ${email.padEnd(34)} contract would be CREATED (after plan)`);
    }
    continue;
  }

  // idempotent: skip if an RPT contract already exists for this customer
  const { data: existing } = await sb
    .from('contracts')
    .select('id')
    .eq('customer_id', customerId)
    .eq('plan_id', planId)
    .in('status', ['active', 'past_due', 'paused', 'incomplete'])
    .maybeSingle();
  if (existing) { skippedContracts++; continue; }

  const { error: cErr } = await sb.from('contracts').insert({
    customer_id: customerId,
    plan_id: planId,
    status: 'active',
    // UTC midnight so the date-only value renders as the intended calendar
    // date in any runtime timezone (formatDate uses local getters).
    started_at: `${m.started}T00:00:00Z`,
  });
  if (cErr) { console.error(`  contract create FAILED ${email}: ${cErr.message}`); continue; }
  createdContracts++;
}

console.log(`\nSummary:`);
console.log(`  customers created: ${createdCustomers}`);
console.log(`  RPT contracts created: ${createdContracts}`);
console.log(`  RPT contracts skipped (already existed): ${skippedContracts}`);
if (newlyCreated.length) {
  console.log(`\n  Newly-created customers (were not previously in DB):`);
  for (const e of newlyCreated) console.log(`    - ${e}`);
}
