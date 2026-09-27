// contracts / support_subscriptions の状態を Stripe の実状態に合わせて修復する。
//   背景: 支援サブスクは default_incomplete で作成され、初回決済完了時に
//   Webhook が active へ昇格させる設計。Webhook が届かないと Stripe 上は
//   active なのに DB は incomplete のまま固着し、会員種別「—」/支援数0/
//   月額¥0 と表示される（決済支援が反映されない不具合）。
//
//   この修復は Stripe を真実として contract/support の status を合わせる。
//   - active        -> active   （会員種別・支援数・月額に反映）
//   - incomplete_expired/canceled/unpaid -> canceled（放置・重複の整理）
//   - incomplete（未決済の正規分）はそのまま
//   口数(units)・月額(monthly_amount)は一切変更しない（client管理のため）。
//   冪等。`--dry` で適用せずプレビュー。
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const DRY = process.argv.includes("--dry");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });

function mapStatus(s, cancelAtPeriodEnd) {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due") return "past_due";
  if (s === "canceled" || s === "incomplete_expired" || s === "unpaid") return "canceled";
  return cancelAtPeriodEnd ? "active" : "incomplete"; // incomplete
}

// stripe_subscription_id を持つ全契約。
let contracts = [];
let from = 0;
for (;;) {
  const { data, error } = await sb
    .from("contracts")
    .select("id, customer_id, status, stripe_subscription_id, current_period_end, canceled_at")
    .not("stripe_subscription_id", "is", null)
    .range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  contracts = contracts.concat(data);
  if (data.length < 1000) break;
  from += 1000;
}

let contractsUpdated = 0, supportsUpdated = 0, errors = 0, unchanged = 0;
const affectedCustomers = new Set();

for (const c of contracts) {
  let sub;
  try { sub = await stripe.subscriptions.retrieve(c.stripe_subscription_id); }
  catch (e) { errors++; console.warn("STRIPE retrieve failed (skip):", c.stripe_subscription_id, e.message); continue; }

  const want = mapStatus(sub.status, sub.cancel_at_period_end);
  const periodEndIso = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  const canceledAtIso = want === "canceled"
    ? (sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : periodEndIso)
    : (sub.cancel_at_period_end ? periodEndIso : null);

  if (c.status === want) { unchanged++; continue; }

  console.log(`contract ${c.id} (cust ${c.customer_id}) : DB ${c.status} -> ${want} [stripe=${sub.status}]`);
  affectedCustomers.add(c.customer_id);

  if (!DRY) {
    const patch = { status: want, canceled_at: canceledAtIso };
    if (periodEndIso) patch.current_period_end = periodEndIso;
    const { error: upErr } = await sb.from("contracts").update(patch).eq("id", c.id);
    if (upErr) { errors++; console.error("  contract update failed:", upErr.message); continue; }
  }
  contractsUpdated++;

  // 紐づく support 行（進行中のみ）を同じ状態へ。
  if (!DRY) {
    const { data: upd, error: ssErr } = await sb
      .from("support_subscriptions")
      .update({ status: want, canceled_at: canceledAtIso })
      .eq("contract_id", c.id)
      .in("status", ["active", "past_due", "incomplete"])
      .neq("status", want)
      .select("id");
    if (ssErr) { errors++; console.error("  support update failed:", ssErr.message); continue; }
    supportsUpdated += upd?.length ?? 0;
  } else {
    const { data: cnt } = await sb
      .from("support_subscriptions").select("id")
      .eq("contract_id", c.id).in("status", ["active", "past_due", "incomplete"]).neq("status", want);
    supportsUpdated += cnt?.length ?? 0;
  }
}

console.log("\n" + (DRY ? "--- DRY RUN ---" : "--- APPLIED ---"));
console.log(`contracts checked: ${contracts.length} | changed: ${contractsUpdated} | unchanged: ${unchanged} | support rows changed: ${supportsUpdated} | errors: ${errors}`);
console.log(`affected customers: ${affectedCustomers.size}`);
process.exit(0);
