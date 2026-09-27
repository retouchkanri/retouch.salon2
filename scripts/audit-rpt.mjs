#!/usr/bin/env node
/** READ-ONLY audit of the 20 RPT members vs the authoritative list. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const c = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
for (const l of c.split('\n')) { const t = l.trim(); if (!t || t.startsWith('#')) continue; const i = t.indexOf('='); if (i < 0) continue; if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Authoritative list: email -> correct full_name
const LIST = [
  ['luckyusagi09@gmail.com', '井出 美枝'],
  ['aki060901@yahoo.co.jp', '宮﨑 佐奈江'],
  ['yoko405e@ybb.ne.jp', '遠藤 陽子'],
  ['yoko@namc.co.jp', '陰山 洋子'],
  ['rei0470@gmail.com', '宮原 玲子'],
  ['tcqmw191@yahoo.co.jp', '真喜志 利雄'],
  ['kiirotennis@icloud.com', '坂尾 貴生子'],
  ['tymnnf_aaawss_@i.softbank.jp', '石田 成美'],
  ['tomoka.kyt.4wt22@ezweb.ne.jp', '高橋 智香'],
  ['melody.takeda.0909@docomo.ne.jp', '武田 真美'],
  ['kyoko320ku@icloud.com', '植田 享子'],
  ['asahi1351kiki@gmail.com', '太田 嘉代子'],
  ['tomoko683467@docomo.ne.jp', '溝口 智子'],
  ['choco-momo-sumomo@h.vodafone.ne.jp', '鈴木 睦子'],
  ['loveciao2525@gmail.com', '西村 美保'],
  ['1999116.y@gmail.com', '渡辺 由美子'],
  ['tamawayoga@gmail.com', '菅田 珠字'],
  ['ku-tan.108@docomo.ne.jp', '中村 洋子'],
  ['ammmaaa.ya@ezweb.ne.jp', '柳田 麻美'],
  ['cha_ko-akemi@au.com', '小原 朱美'],
];

const { data: plan } = await sb.from('membership_plans').select('id').eq('code', 'RPT').maybeSingle();

console.log('email | #customer_rows | db_name | list_name | name_match | #rpt_contracts');
let dupCustomers = 0, nameMismatch = 0, missingContract = 0, multiContract = 0;
for (const [email, listName] of LIST) {
  const { data: custs } = await sb.from('customers').select('id, full_name').eq('email', email.toLowerCase());
  const n = (custs || []).length;
  if (n !== 1) dupCustomers += (n === 0 ? 0 : n - 1);
  const dbName = custs?.[0]?.full_name ?? '(none)';
  const match = dbName === listName;
  if (!match) nameMismatch++;
  let rptN = 0;
  if (custs?.[0]) {
    const { count } = await sb.from('contracts').select('id', { count: 'exact', head: true }).eq('customer_id', custs[0].id).eq('plan_id', plan.id);
    rptN = count ?? 0;
    if (rptN === 0) missingContract++;
    if (rptN > 1) multiContract++;
  }
  console.log(`${email.padEnd(34)} ${n} | ${dbName.padEnd(12)} | ${listName.padEnd(12)} | ${match ? 'ok' : 'DIFF'} | ${rptN}`);
}

// Totals
const { count: totalRpt } = await sb.from('contracts').select('id', { count: 'exact', head: true }).eq('plan_id', plan.id);
const { data: rptRows } = await sb.from('contracts').select('customer_id').eq('plan_id', plan.id);
const distinctCustomers = new Set((rptRows || []).map((r) => r.customer_id)).size;
console.log(`\nTotals: RPT contracts=${totalRpt} | distinct customers with RPT=${distinctCustomers}`);
console.log(`Issues: duplicate customer rows=${dupCustomers} | name mismatches=${nameMismatch} | missing RPT contract=${missingContract} | >1 RPT contract=${multiContract}`);
