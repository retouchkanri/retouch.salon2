#!/usr/bin/env node
/** READ-ONLY verification of the RPT plan + the 20 member contracts. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const c = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
for (const l of c.split('\n')) { const t = l.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i < 0) continue; if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EMAILS = [
  'luckyusagi09@gmail.com','aki060901@yahoo.co.jp','yoko405e@ybb.ne.jp','yoko@namc.co.jp','rei0470@gmail.com',
  'tcqmw191@yahoo.co.jp','kiirotennis@icloud.com','tymnnf_aaawss_@i.softbank.jp','tomoka.kyt.4wt22@ezweb.ne.jp','melody.takeda.0909@docomo.ne.jp',
  'kyoko320ku@icloud.com','asahi1351kiki@gmail.com','tomoko683467@docomo.ne.jp','choco-momo-sumomo@h.vodafone.ne.jp','loveciao2525@gmail.com',
  '1999116.y@gmail.com','tamawayoga@gmail.com','ku-tan.108@docomo.ne.jp','ammmaaa.ya@ezweb.ne.jp','cha_ko-akemi@au.com',
];

const { data: plan } = await sb.from('membership_plans').select('*').eq('code', 'RPT').maybeSingle();
console.log('=== RPT plan ===');
console.log(`  ${plan.name} | code=${plan.code} | ¥${plan.monthly_amount} | with_support=${plan.allow_with_support} | with_team=${plan.allow_with_team} | active=${plan.is_active} | sort=${plan.sort_order}`);

console.log(`\n=== 20 members (contract + summary view) ===`);
let ok = 0, missing = 0;
for (const email of EMAILS) {
  const { data: cust } = await sb.from('customers').select('id, full_name').eq('email', email).maybeSingle();
  if (!cust) { console.log(`  MISSING customer: ${email}`); missing++; continue; }
  const { data: ctr } = await sb
    .from('contracts')
    .select('status, started_at, plan:membership_plans(code, name, monthly_amount)')
    .eq('customer_id', cust.id)
    .eq('plan_id', plan.id)
    .maybeSingle();
  const { data: summ } = await sb.from('v_customer_summary').select('primary_plan_name').eq('customer_id', cust.id).maybeSingle();
  if (!ctr) { console.log(`  ${(cust.full_name||'?').padEnd(10)} ${email.padEnd(34)} NO RPT CONTRACT`); missing++; continue; }
  ok++;
  console.log(`  ${(cust.full_name||'?').padEnd(10)} ${email.padEnd(34)} ${ctr.status} | ¥${ctr.plan?.monthly_amount} | start=${String(ctr.started_at).slice(0,10)} | summary会員種別=${summ?.primary_plan_name ?? '—'}`);
}
console.log(`\nContracts OK: ${ok}/20 | missing: ${missing}`);

// Count all RPT contracts in DB (sanity)
const { count } = await sb.from('contracts').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id);
console.log(`Total RPT contracts in DB: ${count}`);
