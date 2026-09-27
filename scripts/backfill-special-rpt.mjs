// =====================================================================
// ガンガン（特別チーム ¥1,000）/ リタポ（RPT ¥3,000）一括反映スクリプト
//
// 元データ: Stripe の有効サブスクリプション（実際の課金が真実）。
//   - 明細 unit_amount 1000  → ガンガン（special_team_memberships）
//   - 明細 unit_amount 3000  → リタポ（RPT contracts）
// Stripe顧客のメールで public.customers と突合し、未登録分のみ作成する。
//
// 安全設計:
//   - 既存のStripe課金はそのまま。新たな決済は一切行わない（記録のみ）。
//   - status=active で登録。月額合計には加算されない（ビュー設計どおり）。
//   - 既に同種の有効レコードがある顧客はスキップ（重複防止）。
//   - 既定はドライラン。実際に書き込むのは `--apply` 指定時のみ。
//
// 使い方:
//   node scripts/backfill-special-rpt.mjs                 # ドライラン（プレビュー）
//   node scripts/backfill-special-rpt.mjs --apply --gangan-horse=<horse_uuid>
//
// ガンガンを作成するには馬の指定（--gangan-horse）が必須（special_team は horse_id NOT NULL）。
// リタポは馬不要。
// =====================================================================
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const APPLY = process.argv.includes("--apply");
const GANGAN_HORSE = (process.argv.find((a) => a.startsWith("--gangan-horse=")) || "").split("=")[1] || null;
const GANGAN_TEAM_NAME = "目の負傷『ガンガン支援チーム』";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// 1) DBの顧客をメール→{id,name} でインデックス化
const customerByEmail = new Map();
{
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await sb
      .from("customers")
      .select("id, email, full_name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const c of data ?? []) {
      if (c.email) customerByEmail.set(c.email.trim().toLowerCase(), { id: c.id, name: c.full_name });
    }
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
}
console.log(`DB customers indexed by email: ${customerByEmail.size}`);

// 2) 既に有効な特別チーム/リタポを持つ顧客の集合（スキップ判定用）
const hasTeam = new Set();
const hasRpt = new Set();
{
  const { data: st } = await sb
    .from("special_team_memberships")
    .select("customer_id, status")
    .in("status", ["active", "past_due", "incomplete"]);
  for (const r of st ?? []) hasTeam.add(r.customer_id);

  const { data: rptPlan } = await sb
    .from("membership_plans")
    .select("id")
    .eq("code", "RPT")
    .eq("is_active", true)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  var RPT_PLAN_ID = rptPlan?.id ?? null;

  const { data: rptC } = await sb
    .from("contracts")
    .select("customer_id, status, plan:membership_plans(code)")
    .in("status", ["active", "past_due", "incomplete"]);
  for (const r of rptC ?? []) if (r.plan?.code === "RPT") hasRpt.add(r.customer_id);
}

// 3) Stripeの有効サブスクを走査して ¥1,000 / ¥3,000 を抽出
const gangan = []; // {email, subId}
const ritapo = [];
{
  let count = 0;
  for await (const sub of stripe.subscriptions.list({
    status: "active",
    limit: 100,
    expand: ["data.customer", "data.items.data.price"],
  })) {
    count++;
    const email = sub.customer && !sub.customer.deleted ? (sub.customer.email || "").trim().toLowerCase() : "";
    for (const it of sub.items.data) {
      const amt = it.price?.unit_amount;
      if (amt === 1000) gangan.push({ email, subId: sub.id, itemId: it.id });
      else if (amt === 3000) ritapo.push({ email, subId: sub.id, itemId: it.id });
    }
    if (count >= 5000) break;
  }
  console.log(`Stripe active subscriptions scanned: ${count}`);
}

// 4) 突合して分類
function classify(list, hasSet) {
  const toCreate = [];
  const already = [];
  const unmatched = [];
  for (const x of list) {
    if (!x.email) { unmatched.push({ ...x, reason: "Stripe顧客にメールなし" }); continue; }
    const c = customerByEmail.get(x.email);
    if (!c) { unmatched.push({ ...x, reason: "DBに該当顧客なし" }); continue; }
    if (hasSet.has(c.id)) { already.push({ ...x, customer_id: c.id, name: c.name }); continue; }
    toCreate.push({ ...x, customer_id: c.id, name: c.name });
  }
  // 同一顧客の重複（同種で複数サブ）を1件に圧縮
  const seen = new Set();
  const dedupCreate = [];
  for (const r of toCreate) {
    if (seen.has(r.customer_id)) continue;
    seen.add(r.customer_id);
    dedupCreate.push(r);
  }
  return { toCreate: dedupCreate, already, unmatched };
}

const g = classify(gangan, hasTeam);
const r = classify(ritapo, hasRpt);

function report(label, res) {
  console.log(`\n==== ${label} ====`);
  console.log(`新規作成対象: ${res.toCreate.length}件 / 既に登録済み: ${res.already.length}件 / 突合不可: ${res.unmatched.length}件`);
  if (res.toCreate.length) {
    console.log("-- 新規作成 --");
    for (const x of res.toCreate) console.log(`  ${x.name ?? "?"}  <${x.email}>  (${x.subId})`);
  }
  if (res.unmatched.length) {
    console.log("-- 突合不可（手動確認が必要）--");
    for (const x of res.unmatched) console.log(`  <${x.email || "メールなし"}>  ${x.reason}  (${x.subId})`);
  }
}
report("ガンガン（特別チーム ¥1,000）", g);
report("リタポ（RPT ¥3,000）", r);

if (!APPLY) {
  console.log("\n*** ドライラン（書き込みなし）。実行するには --apply を付けてください。 ***");
  console.log("    ガンガン作成には --gangan-horse=<horse_uuid> が必須です。");
  process.exit(0);
}

// 5) 反映（--apply）
//   リタポは馬不要のため常に反映する。
//   ガンガンは --gangan-horse が指定された時のみ反映（未指定ならスキップ）。
let created = { gangan: 0, ritapo: 0 };

if (g.toCreate.length && !GANGAN_HORSE) {
  console.log("\n[スキップ] ガンガンは --gangan-horse=<horse_uuid> 未指定のため反映しません（リタポのみ反映）。");
} else {
  for (const x of g.toCreate) {
    const { error } = await sb.from("special_team_memberships").insert({
      customer_id: x.customer_id,
      horse_id: GANGAN_HORSE,
      monthly_amount: 1000,
      team_name: GANGAN_TEAM_NAME,
      status: "active",
    });
    if (error) { console.log(`  [失敗] ガンガン ${x.email}: ${error.message}`); continue; }
    created.gangan++;
  }
}
for (const x of r.toCreate) {
  if (!RPT_PLAN_ID) { console.log("  [失敗] RPTプランが見つかりません"); break; }
  const { error } = await sb.from("contracts").insert({
    customer_id: x.customer_id,
    plan_id: RPT_PLAN_ID,
    status: "active",
  });
  if (error) { console.log(`  [失敗] リタポ ${x.email}: ${error.message}`); continue; }
  created.ritapo++;
}
console.log(`\n反映完了: ガンガン ${created.gangan}件 / リタポ ${created.ritapo}件 を作成しました。`);
process.exit(0);
