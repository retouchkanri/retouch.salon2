// 旧システムから移行漏れした「メンバーズ会員(A・¥1,800)」の契約を作成する。
//   背景: Stripe では A会員サブスクが有効に課金されているのに、新システムの
//   contracts に行が無いため、管理画面で会員種別が空欄になっていた会員が居る。
//   本スクリプトは、対象会員ごとに Stripe 上の有効な A会員サブスク
//   (price_1ThUP0...＝¥1,800「メンバーズ会員」) を見つけ、それに紐づく
//   active な A契約を作成する（新たな課金は発生しない。既存サブスクへの紐付けのみ）。
//
//   ガード:
//     - DB顧客が存在し、status=active であること。
//     - 既に有効な契約(基本/支援)を持っていないこと（重複作成防止）。
//     - 当該 stripe_subscription_id の契約が未作成であること（冪等）。
//     - Stripe サブスクの item が A会員価格(¥1,800)であること。
//   `--dry` で適用せずプレビュー。
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const DRY = process.argv.includes("--dry");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });

const A_PLAN_ID = "b455a954-d32f-4d40-84c9-b1a9ea4e8fd1"; // メンバーズ会員 (A, ¥1800, active)
const A_PRICE_ID = "price_1ThUP0I78wDNWYHlG2KMsAr9";
const A_AMOUNT = 1800;

// 対象（純粋にA会員のみで、移行漏れ＝完全非表示の5名）。
const EMAILS = [
  "ayamehorse1105@gmail.com",
  "miko.suz@gmail.com",
  "misamama.5050.0909@gmail.com",
  "rabbistomp279@docomo.ne.jp",
  "anechama@ezweb.ne.jp",
];

let created = 0, skipped = 0, failed = 0;
for (const email of EMAILS) {
  const { data: cust } = await sb.from("customers").select("id, full_name, status, stripe_customer_id").eq("email", email).maybeSingle();
  if (!cust) { console.warn("SKIP no DB customer:", email); skipped++; continue; }
  if (cust.status !== "active") { console.warn("SKIP not active customer:", email, cust.status); skipped++; continue; }

  // 既存の有効契約があればスキップ（重複防止）。
  const { data: existingActive } = await sb.from("contracts").select("id").eq("customer_id", cust.id).in("status", ["active", "past_due"]).limit(1);
  if (existingActive && existingActive.length) { console.warn("SKIP already has active contract:", email); skipped++; continue; }

  // Stripe顧客IDを解決（DB未登録なら email で照合）。
  let stripeCustomerId = cust.stripe_customer_id;
  let aSub = null;
  if (stripeCustomerId) {
    const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 20 });
    aSub = subs.data.find((s) =>
      ["active", "past_due", "trialing"].includes(s.status) &&
      s.items.data.some((it) => it.price.id === A_PRICE_ID || it.price.unit_amount === A_AMOUNT));
  } else {
    const sc = await stripe.customers.list({ email, limit: 10 });
    for (const c of sc.data) {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 20 });
      const m = subs.data.find((s) =>
        ["active", "past_due", "trialing"].includes(s.status) &&
        s.items.data.some((it) => it.price.id === A_PRICE_ID || it.price.unit_amount === A_AMOUNT));
      if (m) { stripeCustomerId = c.id; aSub = m; break; }
    }
  }
  if (!aSub) { console.warn("SKIP no active A sub in Stripe:", email); skipped++; continue; }

  // 当該サブスクの契約が既にあれば冪等スキップ。
  const { data: existsBySub } = await sb.from("contracts").select("id").eq("stripe_subscription_id", aSub.id).limit(1);
  if (existsBySub && existsBySub.length) { console.warn("SKIP contract for sub already exists:", email, aSub.id); skipped++; continue; }

  const periodEndIso = aSub.current_period_end ? new Date(aSub.current_period_end * 1000).toISOString() : null;
  const startedIso = aSub.start_date ? new Date(aSub.start_date * 1000).toISOString() : null;

  console.log(`${DRY ? "[DRY] " : ""}CREATE A契約: ${cust.full_name} <${email}> stripeCust=${stripeCustomerId} sub=${aSub.id} period_end=${periodEndIso}${cust.stripe_customer_id ? "" : " (+stripe_customer_id補完)"}`);
  if (DRY) { created++; continue; }

  // DB顧客に stripe_customer_id が未設定なら補完（今後の同期・突合のため）。
  if (!cust.stripe_customer_id && stripeCustomerId) {
    await sb.from("customers").update({ stripe_customer_id: stripeCustomerId }).eq("id", cust.id);
  }

  const { error } = await sb.from("contracts").insert({
    customer_id: cust.id,
    plan_id: A_PLAN_ID,
    status: "active",
    stripe_subscription_id: aSub.id,
    current_period_end: periodEndIso,
    started_at: startedIso,
  });
  if (error) { console.error("  INSERT failed:", error.message); failed++; continue; }
  created++;
}

console.log("\n" + (DRY ? "--- DRY RUN ---" : "--- APPLIED ---"));
console.log(`created: ${created} | skipped: ${skipped} | failed: ${failed}`);
process.exit(0);
