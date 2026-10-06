#!/usr/bin/env node
/**
 * 返金済みの決済行に、Stripe の返金額（raw.amount_refunded）を入れる。
 *
 * 2026-10 に Stripe と照合して分かったこと：一部だけ返金した決済も、集計では全額返金として
 * 落ちていた（7〜9月の一口支援で 13件、残っている入金 計 74,753円）。Stripe 同期はこれ以降
 * 返金額を保存するが、すでに同期済みの行には入っていないので、この1回だけ埋める。
 *
 * 行ごとに Stripe の決済を引き、raw に amount_refunded（と、無ければ refunded_at）を足すだけ。
 * 金額・状態・ほかの項目は変えない。
 *
 * 使い方:
 *   node scripts/backfill-refund-amounts.mjs           # 確認のみ（変更なし）
 *   node scripts/backfill-refund-amounts.mjs --apply   # 反映（変更前の raw を logs/ に保存）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("payments")
    .select("id, amount, occurred_at, stripe_charge_id, raw")
    .eq("status", "refunded")
    .not("stripe_charge_id", "is", null)
    .order("id")
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data);
  if (data.length < 1000) break;
}
console.log(`返金済みの決済行: ${rows.length}件`);
console.log(APPLY ? "モード: --apply（反映します）" : "モード: 確認のみ（--apply で反映）");

const changes = [];
for (const row of rows) {
  const charge = await stripe.charges.retrieve(row.stripe_charge_id, { expand: ["refunds"] });
  const refunded = charge.amount_refunded ?? 0;
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  const refundedAtUnix = charge.refunds?.data?.[0]?.created;
  const next = {
    ...raw,
    amount_refunded: refunded,
    refunded_at: raw.refunded_at ?? (refundedAtUnix ? new Date(refundedAtUnix * 1000).toISOString() : null),
  };
  const kind = refunded >= row.amount ? "全額返金" : refunded > 0 ? "一部返金" : "返金なし（要確認）";
  console.log(`  ${String(row.occurred_at).slice(0, 10)} 決済 ${yen(row.amount)} / 返金 ${yen(refunded)} / 残り ${yen(row.amount - refunded)} … ${kind}`);
  if (charge.amount !== row.amount) console.log(`    ! Stripe の決済額 ${yen(charge.amount)} と行の金額が違います。この行は変更しません。`);
  else if (raw.amount_refunded !== refunded) changes.push({ id: row.id, before: row.raw, after: next });
}
const partial = changes.filter((c) => c.after.amount_refunded > 0 && c.after.amount_refunded < rows.find((r) => r.id === c.id).amount);
console.log(`更新が必要な行: ${changes.length}件（うち一部返金 ${partial.length}件）`);

if (!APPLY || changes.length === 0) process.exit(0);

const backup = path.resolve(__dirname, `../logs/refund-amounts-backup-${new Date().toISOString().slice(0, 10)}.json`);
fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.writeFileSync(backup, JSON.stringify(changes.map((c) => ({ id: c.id, raw: c.before })), null, 1));
console.log(`変更前の raw を保存しました: ${backup}`);

let done = 0;
for (const change of changes) {
  const { error } = await sb.from("payments").update({ raw: change.after }).eq("id", change.id).eq("status", "refunded");
  if (error) console.error(`  ! 更新失敗 ${change.id}: ${error.message}`);
  else done += 1;
}
console.log(`更新しました: ${done}/${changes.length}件`);
