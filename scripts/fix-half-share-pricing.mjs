#!/usr/bin/env node
/**
 * Fix the "half-of-half" pricing bug in support_subscriptions.
 *
 * Correct rule: monthly_amount === round(12000 * units)
 *   - 半口 (units=0.5) -> 6000  (was wrongly 3000)
 *   - 1口  (units=1)   -> 12000 (already correct)
 *   - units=2/3/8      -> 24000/36000/96000 (already correct)
 *
 * Safety:
 *   - Backs up ALL support_subscriptions rows to a timestamped JSON.
 *   - Only updates rows whose monthly_amount differs from the correct value.
 *   - No Stripe calls (records carry no stripe ids).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const PER_UNIT = 12000; // 1口 = 12,000円, so 半口(0.5) = 6,000円

// 1. Fetch all support rows (full, for backup + computation)
const { data: rows, error } = await sb
  .from('support_subscriptions')
  .select('*');
if (error) { console.error('fetch error', error); process.exit(1); }

// 2. Backup
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.resolve(__dirname, `../backups/support_subscriptions_${stamp}.json`);
fs.mkdirSync(path.dirname(backupPath), { recursive: true });
fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2), 'utf8');
console.log(`Backed up ${rows.length} rows -> ${backupPath}`);

// 3. Compute the rows that need fixing
const toFix = rows
  .map((r) => ({ id: r.id, units: Number(r.units), old: r.monthly_amount, next: Math.round(PER_UNIT * Number(r.units)), status: r.status }))
  .filter((r) => r.old !== r.next);

console.log(`\nRows needing correction: ${toFix.length}`);
const byChange = {};
for (const r of toFix) {
  const k = `units=${r.units}: ${r.old} -> ${r.next} (${r.status})`;
  byChange[k] = (byChange[k] || 0) + 1;
}
for (const [k, v] of Object.entries(byChange).sort()) console.log(`  ${k}  x${v}`);

if (toFix.length === 0) { console.log('\nNothing to fix.'); process.exit(0); }

// 4. Apply updates one-by-one (small set; precise + auditable)
let updated = 0, failed = 0;
for (const r of toFix) {
  const { error: upErr } = await sb
    .from('support_subscriptions')
    .update({ monthly_amount: r.next })
    .eq('id', r.id);
  if (upErr) { failed++; console.error(`  FAIL ${r.id}: ${upErr.message}`); }
  else updated++;
}
console.log(`\nUpdated: ${updated}, Failed: ${failed}`);
