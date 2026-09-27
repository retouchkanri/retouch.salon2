// 鶴田ゆい様（kosaeru3@gmail.com）の「ピース号 半口支援(¥6,000)」を反映する。
//   Stripe では半口支援サブスクが有効に課金されているのに、新システムに
//   support_subscriptions 行が無く、会員種別「—」/支援数0/月額¥0 だった。
//   対象馬（ピース）と口数（0.5口=¥6,000）はお客様確認済みのため、
//   既存の有効 Stripe サブスクへ紐付けて support 行＋SUPPORT契約を作成する。
//   （新たな課金は発生しない。冪等。`--dry` でプレビュー。）
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const DRY = process.argv.includes("--dry");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });

const EMAIL = "kosaeru3@gmail.com";
const HORSE_ID = "4f2ef2ff-5911-48ad-955a-c1277387c9b3"; // 49：ピース
const SUPPORT_PLAN_ID = "de75b8df-66d3-496f-bd84-8961654d839b"; // 1口支援馬会員(SUPPORT, active)
const SUB_ID = "sub_1Tet6AI78wDNWYHlDoF8WPo6"; // 有効な半口支援(¥6,000)サブスク
const ITEM_ID = "si_UeBTQw8AYqfDmx";
const STRIPE_CUSTOMER_ID = "cus_UeBTNktpdtWwso";
const UNITS = 0.5;
const MONTHLY = 6000;

const { data: cust } = await sb.from("customers").select("id, full_name, stripe_customer_id").eq("email", EMAIL).maybeSingle();
if (!cust) { console.error("no customer"); process.exit(1); }

// ガード: 当該馬で有効な support 行が既にあれば何もしない。
const { data: existSupport } = await sb.from("support_subscriptions").select("id,status")
  .eq("customer_id", cust.id).eq("horse_id", HORSE_ID).in("status", ["active", "past_due", "incomplete"]).maybeSingle();
if (existSupport) { console.log("ALREADY has support row for ピース:", existSupport.id, existSupport.status, "-> 何もしません"); process.exit(0); }

// Stripe 実状態の確認（安全のため）。
const sub = await stripe.subscriptions.retrieve(SUB_ID);
const amt = sub.items.data.reduce((a, it) => a + (it.price.unit_amount ?? 0) * (it.quantity ?? 1), 0);
if (sub.status !== "active" || amt !== MONTHLY) { console.error(`Stripe状態不一致: status=${sub.status} amount=${amt}（期待 active/¥${MONTHLY}）`); process.exit(1); }
const periodEndIso = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
const startedIso = sub.start_date ? new Date(sub.start_date * 1000).toISOString() : null;

console.log(`${DRY ? "[DRY] " : ""}対象: ${cust.full_name} <${EMAIL}>`);
console.log(`  契約: SUPPORT(${SUPPORT_PLAN_ID}) active sub=${SUB_ID} period_end=${periodEndIso}`);
console.log(`  支援: ピース 0.5口 / ¥${MONTHLY} item=${ITEM_ID}`);

if (DRY) { console.log("\n--- DRY RUN（未適用）---"); process.exit(0); }

// stripe_customer_id 補完。
if (!cust.stripe_customer_id) {
  await sb.from("customers").update({ stripe_customer_id: STRIPE_CUSTOMER_ID }).eq("id", cust.id);
}

// 既存サブスクの契約があれば再利用、無ければ作成。
let contractId;
const { data: existContract } = await sb.from("contracts").select("id").eq("stripe_subscription_id", SUB_ID).maybeSingle();
if (existContract) {
  contractId = existContract.id;
} else {
  const { data: ct, error: cErr } = await sb.from("contracts").insert({
    customer_id: cust.id,
    plan_id: SUPPORT_PLAN_ID,
    status: "active",
    stripe_subscription_id: SUB_ID,
    current_period_end: periodEndIso,
    started_at: startedIso,
  }).select("id").single();
  if (cErr) { console.error("contract insert failed:", cErr.message); process.exit(1); }
  contractId = ct.id;
}

const { error: sErr } = await sb.from("support_subscriptions").insert({
  contract_id: contractId,
  customer_id: cust.id,
  horse_id: HORSE_ID,
  units: UNITS,
  monthly_amount: MONTHLY,
  status: "active",
  stripe_subscription_item_id: ITEM_ID,
  started_at: startedIso,
});
if (sErr) { console.error("support insert failed:", sErr.message); process.exit(1); }

console.log("\n--- APPLIED ---  contract:", contractId);
process.exit(0);
