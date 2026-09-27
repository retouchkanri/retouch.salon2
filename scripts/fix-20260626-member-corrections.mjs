// 2026-06-26 会員情報修正
//   1. 野村晴代 (kouta1999@docomo.ne.jp)
//      半口支援会員なのに一口支援と表示されている → support_subscriptions.units を 1.0→0.5、
//      monthly_amount を 12000→6000 に修正
//   2. 辻野利奈 (rina_anil_1018@yahoo.co.jp)
//      メンバーズ会員（A, ¥1800）になっているが、アテンダー会員（A, ¥0）が正しい →
//      contracts の plan_id をアテンダー会員プランに変更
// `--dry` で変更せずプレビューのみ。
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ── Case 1: 野村晴代 — support units 1.0 → 0.5 ─────────────────────────────
console.log("\n=== Case 1: 野村晴代 (kouta1999@docomo.ne.jp) ===");
const { data: nomura } = await sb
  .from("customers")
  .select("id, full_name, email, status")
  .eq("email", "kouta1999@docomo.ne.jp")
  .maybeSingle();

if (!nomura) {
  console.error("ERROR: 野村晴代 not found by email kouta1999@docomo.ne.jp");
} else {
  console.log(`Customer: ${nomura.full_name} (${nomura.id}) status=${nomura.status}`);

  const { data: subs } = await sb
    .from("support_subscriptions")
    .select("id, horse_id, units, monthly_amount, status")
    .eq("customer_id", nomura.id)
    .neq("status", "canceled");

  if (!subs || subs.length === 0) {
    console.warn("WARNING: active support_subscriptions not found");
  } else {
    console.log("Current support_subscriptions:", JSON.stringify(subs, null, 2));

    // 1.0口（12000円）の行を 0.5口（6000円）に修正
    const targets = subs.filter(
      (s) => Number(s.units) === 1.0 && Number(s.monthly_amount) === 12000
    );

    if (targets.length === 0) {
      // 既に正しい可能性、または金額が違う場合
      const alreadyOk = subs.filter(
        (s) => Number(s.units) === 0.5 && Number(s.monthly_amount) === 6000
      );
      if (alreadyOk.length > 0) {
        console.log("既に units=0.5, monthly_amount=6000 です（修正済み）。スキップします。");
      } else {
        console.warn("WARNING: units=1.0, monthly_amount=12000 の行が見つかりません。手動確認してください。");
        console.log("全行:", JSON.stringify(subs, null, 2));
      }
    } else {
      for (const row of targets) {
        console.log(
          `${DRY ? "[DRY] " : ""}UPDATE support_subscriptions id=${row.id}: units 1.0→0.5, monthly_amount 12000→6000`
        );
        if (!DRY) {
          const { error } = await sb
            .from("support_subscriptions")
            .update({ units: 0.5, monthly_amount: 6000 })
            .eq("id", row.id);
          if (error) {
            console.error("  UPDATE failed:", error.message);
          } else {
            console.log("  OK");
          }
        }
      }
    }
  }
}

// ── Case 2: 辻野利奈 — plan → アテンダー会員 ────────────────────────────────
console.log("\n=== Case 2: 辻野利奈 (rina_anil_1018@yahoo.co.jp) ===");

// アテンダー会員プランを取得
const { data: attenderPlan } = await sb
  .from("membership_plans")
  .select("id, code, name, monthly_amount")
  .eq("code", "A")
  .eq("name", "アテンダー会員")
  .eq("monthly_amount", 0)
  .maybeSingle();

if (!attenderPlan) {
  console.error("ERROR: アテンダー会員プランが見つかりません。add-attender-plan.mjs を先に実行してください。");
} else {
  console.log("アテンダー会員プラン:", JSON.stringify(attenderPlan));

  const { data: tsujino } = await sb
    .from("customers")
    .select("id, full_name, email, status")
    .eq("email", "rina_anil_1018@yahoo.co.jp")
    .maybeSingle();

  if (!tsujino) {
    console.error("ERROR: 辻野利奈 not found by email rina_anil_1018@yahoo.co.jp");
  } else {
    console.log(`Customer: ${tsujino.full_name} (${tsujino.id}) status=${tsujino.status}`);

    // 現在の有効な基本会員契約を取得（A/B/C/OWNERコード）
    const { data: contracts } = await sb
      .from("contracts")
      .select("id, plan_id, status, membership_plans(id, code, name, monthly_amount)")
      .eq("customer_id", tsujino.id)
      .in("status", ["active", "past_due", "incomplete"]);

    if (!contracts || contracts.length === 0) {
      console.warn("WARNING: 有効な contracts が見つかりません");
    } else {
      console.log("Current contracts:", JSON.stringify(contracts, null, 2));

      // アテンダー以外の Aコード（メンバーズ会員）の契約を探す
      const membersPlan = contracts.filter(
        (c) => c.membership_plans?.code === "A" && c.plan_id !== attenderPlan.id
      );

      if (membersPlan.length === 0) {
        const alreadyAttender = contracts.filter(
          (c) => c.plan_id === attenderPlan.id
        );
        if (alreadyAttender.length > 0) {
          console.log("既にアテンダー会員プランです（修正済み）。スキップします。");
        } else {
          console.warn("WARNING: code=A の contracts が見つかりません。手動確認してください。");
        }
      } else {
        for (const contract of membersPlan) {
          console.log(
            `${DRY ? "[DRY] " : ""}UPDATE contracts id=${contract.id}: plan_id → アテンダー会員 (${attenderPlan.id})`
          );
          console.log(`  現プラン: ${contract.membership_plans?.name} ¥${contract.membership_plans?.monthly_amount}`);
          if (!DRY) {
            const { error } = await sb
              .from("contracts")
              .update({ plan_id: attenderPlan.id })
              .eq("id", contract.id);
            if (error) {
              console.error("  UPDATE failed:", error.message);
            } else {
              console.log("  OK");
            }
          }
        }
      }
    }
  }
}

console.log("\n" + (DRY ? "--- DRY RUN 完了 ---" : "--- 適用完了 ---"));
