#!/usr/bin/env node
/**
 * 支援（一口／半口）課金の DB ⇔ Stripe 突き合わせ監査・修復ツール。
 *
 * 2026-09 の過剰請求（半口が1口として請求される／停止したのに引き落とされる／
 * 別カードで二重に請求される）を洗い出して直すために作成。同じズレが二度と
 * 静かに残らないよう、定期実行して差分ゼロを保つこと。
 *
 * 検出する不整合:
 *   [QTY]   Stripe item の数量が DB の monthly_amount と一致しない
 *           （半口=1, 1口=2, 1.5口=3 … 単価6,000円 × 数量）
 *   [DEAD]  DB は生きているのに Stripe item が存在しない／サブスクが死んでいる
 *   [ORPHAN] Stripe に支援 item があるのに、対応する生きた DB 行が無い
 *           （※どちらが正しいかは自明でない。「停止したのに引き落とされている」
 *             ケースと、「DB行が誤って canceled にされただけで請求自体は正しい」
 *             ケースの両方がある。会員の意向を確認してから対応すること）
 *   [DUP]   同じ (会員, 馬) に生きている支援行が複数ある
 *   [MULTICUST] 同じメールに複数のStripe顧客があり、DB管理外でも課金が続いている
 *           （＝別カードからの二重引き落とし。管理画面には表示されない）
 *   [SHADOW] 管理外のStripe顧客だけで課金が続いている（移行漏れ・管理画面に出ない）
 *   [MULTISUB] 1会員に生きている支援サブスクリプションが複数ある
 *           （＝別カードに二重請求されうる）
 *   [PRICE] 支援 item の単価が 6,000円（半口クオンタム）でない
 *
 * 使い方:
 *   node scripts/audit-support-billing.mjs                 # 全件レポート（変更なし）
 *   node scripts/audit-support-billing.mjs --email=a@b.jp  # 1会員だけ
 *   node scripts/audit-support-billing.mjs --fix           # 安全な修復を適用
 *   node scripts/audit-support-billing.mjs --fix --cancel-orphans
 *                                                         # 孤立 item も削除
 *
 * --fix で行うこと（いずれも DB を正とする）:
 *   [QTY]   Stripe item の数量を DB に合わせる（proration あり）
 *   [DEAD]  DB 行を canceled にして item id を外す（勝手に課金を作り直さない）
 *   [ORPHAN] --cancel-orphans 指定時のみ Stripe item を削除
 *           （既定では削除しない。請求側が正しく DB 行の方が誤って停止されて
 *             いる場合、削除すると正当な支援まで止めてしまうため）
 *   [DUP] / [MULTISUB] は自動修復しない（返金判断が必要なため報告のみ）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env.local を読む。手書きパーサだと値を囲む引用符が残り、Stripe/Supabase の
// キーがそのまま壊れるため dotenv を使う（reconcile-subscription-status.mjs と同じ）。
config({ path: path.resolve(__dirname, "../.env.local") });

const args = process.argv.slice(2);
const FIX = args.includes("--fix");
const CANCEL_ORPHANS = args.includes("--cancel-orphans");
const EMAIL = (args.find((a) => a.startsWith("--email=")) ?? "").split("=")[1] ?? null;

const SUPPORT_UNIT_PRICE = 12000; // 1口
const QUANTUM = SUPPORT_UNIT_PRICE / 2; // 半口 = Stripe の単価
const LIVE = ["active", "past_due", "incomplete"];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });

const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const unitsLabel = (u) => `${Number(u)}口`;
const isSubLive = (s) => s.status !== "canceled" && s.status !== "incomplete_expired";

async function fetchAll(table, select, tweak) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(select).range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * 同じメールに紐づく「管理外の Stripe 顧客」で課金が続いていないか確認する。
 *
 * customers.stripe_customer_id は1件しか指せないため、旧 Stripe 顧客に残った
 * サブスクリプションは管理画面からまったく見えない。会員から見れば別のカードで
 * 引き落としが続いている状態で、2026-09 の「2枚のカードから引かれている」報告の
 * 正体がこれだった。
 *
 * linkedIsBilling=true（紐付け顧客でも課金中）なら二重課金の疑い [MULTICUST]、
 * false なら管理画面から見えない旧課金 [SHADOW]（移行漏れ）として区別する。
 */
async function checkShadowCustomers(customer, who, linkedIsBilling) {
  if (!customer.email) return;
  try {
    const matches = (await stripe.customers.list({ email: customer.email, limit: 100 })).data.filter(
      (x) => !x.deleted,
    );
    const others = matches.filter((x) => x.id !== customer.stripe_customer_id);
    const shadow = [];
    for (const other of others) {
      const subs = await stripe.subscriptions.list({ customer: other.id, status: "all", limit: 100 });
      const live = subs.data.filter(isSubLive);
      if (live.length === 0) continue;
      const amount = live.reduce(
        (acc, s) =>
          acc + s.items.data.reduce((a, it) => a + (it.price?.unit_amount ?? 0) * (it.quantity ?? 1), 0),
        0,
      );
      shadow.push(`${other.id}=${yen(amount)}/月 × ${live.length}本`);
    }
    if (shadow.length === 0) return;
    record(
      who,
      linkedIsBilling ? "MULTICUST" : "SHADOW",
      linkedIsBilling
        ? `二重課金の疑い: 紐付け顧客(${customer.stripe_customer_id})でも課金中、` +
          `さらに管理外の顧客でも課金継続 → ${shadow.join(", ")}`
        : `管理外の Stripe 顧客で課金が継続しています（管理画面に表示されません） → ${shadow.join(", ")}` +
          `（DB紐付けは ${customer.stripe_customer_id ?? "なし"}）`,
      { linked: customer.stripe_customer_id, shadow: others.map((o) => o.id) },
    );
  } catch (e) {
    record(who, "STRIPE_ERROR", `Stripe顧客の重複確認に失敗: ${e.message}`);
  }
}

// ---------------------------------------------------------------- load DB
let customers = await fetchAll(
  "customers",
  "id, email, full_name, stripe_customer_id",
  (q) => (EMAIL ? q.ilike("email", EMAIL) : q),
);
if (EMAIL && customers.length === 0) {
  console.error(`該当会員が見つかりません: ${EMAIL}`);
  process.exit(1);
}
const customerIds = new Set(customers.map((c) => c.id));

const supports = (
  await fetchAll(
    "support_subscriptions",
    "id, customer_id, contract_id, horse_id, units, monthly_amount, status, canceled_at, stripe_subscription_item_id, horse:horses(name)",
    (q) => q.in("status", LIVE),
  )
).filter((s) => customerIds.has(s.customer_id));

const contracts = (
  await fetchAll("contracts", "id, customer_id, status, stripe_subscription_id, plan:membership_plans(code, name)")
).filter((c) => customerIds.has(c.customer_id));

// 会員ごとにまとめる。支援行が1件も無い会員は監査対象外。
const byCustomer = new Map();
for (const s of supports) {
  if (!byCustomer.has(s.customer_id)) byCustomer.set(s.customer_id, { supports: [], contracts: [] });
  byCustomer.get(s.customer_id).supports.push(s);
}
for (const c of contracts) {
  const entry = byCustomer.get(c.customer_id);
  if (entry) entry.contracts.push(c);
}
customers = customers.filter((c) => byCustomer.has(c.id));

console.log(`監査対象: ${customers.length}名 / 支援行 ${supports.length}件`);
console.log(FIX ? "モード: --fix（修復を適用します）" : "モード: レポートのみ（--fix で修復）");
console.log("");

// ------------------------------------------------------------ audit loop
const findings = [];
const record = (customer, kind, detail, extra = {}) => {
  findings.push({ customer, kind, detail, ...extra });
};

let fixedQty = 0;
let fixedDead = 0;
let removedOrphans = 0;

for (const customer of customers) {
  const { supports: rows } = byCustomer.get(customer.id);
  const who = `${customer.full_name ?? "(名前なし)"} <${customer.email ?? "-"}>`;

  // --- [DUP] 同じ馬に生きた行が複数
  const perHorse = new Map();
  for (const r of rows) {
    if (!perHorse.has(r.horse_id)) perHorse.set(r.horse_id, []);
    perHorse.get(r.horse_id).push(r);
  }
  for (const [, list] of perHorse) {
    if (list.length > 1) {
      record(
        who,
        "DUP",
        `馬「${list[0].horse?.name ?? "?"}」に生きた支援行が${list.length}件` +
          `（${list.map((r) => `${unitsLabel(r.units)}/${r.status}`).join(" + ")}）`,
        { ids: list.map((r) => r.id) },
      );
    }
  }

  if (!customer.stripe_customer_id) {
    // Stripe顧客が未紐付け＝運営手動請求、または移行漏れ。
    // 行の突き合わせはできないが、旧Stripe顧客での課金継続だけは必ず確認する。
    await checkShadowCustomers(customer, who, false);
    continue;
  }

  // --- Stripe 側の実データ
  let subs = [];
  try {
    const res = await stripe.subscriptions.list({
      customer: customer.stripe_customer_id,
      status: "all",
      limit: 100,
      expand: ["data.items.data.price"],
    });
    subs = res.data;
    // Subscription オブジェクトに埋め込まれる items は先頭10件まで。
    // 4頭以上を支援している会員では黙って欠落し、実在する item を
    // 「孤立」と誤判定してしまうので、超過分は明示的に取得する。
    for (const sub of subs) {
      if (!sub.items?.has_more) continue;
      const all = [];
      for await (const it of stripe.subscriptionItems.list({ subscription: sub.id, limit: 100 })) {
        all.push(it);
      }
      sub.items.data = all;
      sub.items.has_more = false;
    }
  } catch (e) {
    record(who, "STRIPE_ERROR", `サブスクリプション取得に失敗: ${e.message}`);
    continue;
  }
  const liveSubs = subs.filter(isSubLive);

  // 支援 item の判定: 作成時に metadata.support_id を必ず付けている。
  const supportItems = [];
  for (const sub of liveSubs) {
    if (sub.metadata?.kind === "special_team") continue;
    for (const item of sub.items.data) {
      if (item.metadata?.support_id) supportItems.push({ sub, item });
    }
  }

  // --- [MULTISUB] 支援 item を持つ生きたサブスクが複数
  const supportSubIds = [...new Set(supportItems.map((x) => x.sub.id))];
  if (supportSubIds.length > 1) {
    const totals = supportSubIds.map((id) => {
      const s = liveSubs.find((x) => x.id === id);
      const amount = s.items.data.reduce(
        (acc, it) => acc + (it.price?.unit_amount ?? 0) * (it.quantity ?? 1),
        0,
      );
      return `${id}=${yen(amount)}/月 (${s.status})`;
    });
    record(
      who,
      "MULTISUB",
      `生きた支援サブスクリプションが${supportSubIds.length}本あります → ${totals.join(", ")}`,
      { subscriptionIds: supportSubIds },
    );
  }

  await checkShadowCustomers(customer, who, liveSubs.length > 0);

  const itemById = new Map(supportItems.map((x) => [x.item.id, x]));
  const claimedItemIds = new Set();

  // --- 行ごとの突き合わせ
  for (const row of rows) {
    const wantQty = Math.max(1, Math.round(Number(row.monthly_amount) / QUANTUM));
    const horse = row.horse?.name ?? "?";

    if (!row.stripe_subscription_item_id) {
      // Stripe 課金に紐づかない行（運営手動請求）。異常ではない。
      continue;
    }
    claimedItemIds.add(row.stripe_subscription_item_id);

    const found = itemById.get(row.stripe_subscription_item_id);
    if (!found) {
      // item が消えている / サブスクが死んでいる
      record(
        who,
        "DEAD",
        `「${horse}」${unitsLabel(row.units)} (${yen(row.monthly_amount)}/月, ${row.status}) の Stripe item が存在しません`,
        { supportId: row.id, itemId: row.stripe_subscription_item_id },
      );
      if (FIX) {
        const { error } = await sb
          .from("support_subscriptions")
          .update({
            status: "canceled",
            canceled_at: new Date().toISOString(),
            stripe_subscription_item_id: null,
          })
          .eq("id", row.id);
        if (error) console.error(`  ! DB更新失敗 ${row.id}: ${error.message}`);
        else fixedDead += 1;
      }
      continue;
    }

    const { item } = found;
    const unitAmount = item.price?.unit_amount ?? 0;
    if (unitAmount !== QUANTUM) {
      record(
        who,
        "PRICE",
        `「${horse}」の Stripe 単価が ${yen(unitAmount)}（期待値 ${yen(QUANTUM)}）— 数量計算が成立しません`,
        { supportId: row.id, itemId: item.id },
      );
      continue; // 単価が違う item に数量を書き込むと余計にずれる
    }

    const haveQty = item.quantity ?? 1;
    if (haveQty !== wantQty) {
      record(
        who,
        "QTY",
        `「${horse}」DB=${unitsLabel(row.units)}(${yen(row.monthly_amount)}/月, 数量${wantQty}) ⇔ ` +
          `Stripe=数量${haveQty}(${yen(unitAmount * haveQty)}/月) — 差額 ${yen(unitAmount * haveQty - row.monthly_amount)}/月`,
        { supportId: row.id, itemId: item.id, wantQty, haveQty },
      );
      if (FIX) {
        try {
          await stripe.subscriptionItems.update(item.id, {
            quantity: wantQty,
            proration_behavior: "create_prorations",
          });
          fixedQty += 1;
        } catch (e) {
          console.error(`  ! Stripe更新失敗 ${item.id}: ${e.message}`);
        }
      }
    }
  }

  // --- [ORPHAN] DB に対応する生きた行が無い支援 item
  for (const { sub, item } of supportItems) {
    if (claimedItemIds.has(item.id)) continue;
    const amount = (item.price?.unit_amount ?? 0) * (item.quantity ?? 1);
    record(
      who,
      "ORPHAN",
      `Stripe に支援 item が残っています (${item.id}, ${yen(amount)}/月, sub=${sub.id}) が、対応する生きた支援行がありません。` +
        `「停止済みなのに課金継続」か「DB行だけ誤って停止された」かを会員の意向で確認してください`,
      { itemId: item.id, subscriptionId: sub.id, isLastItem: sub.items.data.length <= 1 },
    );
    if (FIX && CANCEL_ORPHANS) {
      try {
        if (sub.items.data.length <= 1) {
          await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: true });
        } else {
          await stripe.subscriptionItems.del(item.id, { proration_behavior: "create_prorations" });
        }
        removedOrphans += 1;
      } catch (e) {
        console.error(`  ! Stripe削除失敗 ${item.id}: ${e.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------- report
const order = ["ORPHAN", "QTY", "MULTICUST", "MULTISUB", "DUP", "SHADOW", "DEAD", "PRICE", "STRIPE_ERROR"];
const grouped = new Map();
for (const f of findings) {
  if (!grouped.has(f.kind)) grouped.set(f.kind, []);
  grouped.get(f.kind).push(f);
}

if (findings.length === 0) {
  console.log("✅ 不整合はありません（DB と Stripe は一致しています）。");
} else {
  for (const kind of order) {
    const list = grouped.get(kind);
    if (!list) continue;
    console.log(`── [${kind}] ${list.length}件 ──────────────────────────────`);
    for (const f of list) console.log(`  ${f.customer}\n     ${f.detail}`);
    console.log("");
  }
}

if (FIX) {
  console.log("── 適用結果 ──");
  console.log(`  数量を DB に合わせた item : ${fixedQty}`);
  console.log(`  canceled にした支援行      : ${fixedDead}`);
  console.log(`  削除した孤立 item          : ${removedOrphans}${CANCEL_ORPHANS ? "" : "（--cancel-orphans 未指定のためスキップ）"}`);
  console.log("");
  console.log("※ [DUP] / [MULTISUB] は返金判断を伴うため自動修復していません。");
  console.log("  管理画面で余分な支援を停止し、Stripe 側で返金してください。");
} else if (findings.length > 0) {
  console.log("修復するには --fix（孤立 item も消す場合は --fix --cancel-orphans）を付けて再実行してください。");
}

// 監査結果を残す（返金対応の証跡）
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = path.resolve(__dirname, `../backups/support-billing-audit_${stamp}.json`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ mode: FIX ? "fix" : "report", findings }, null, 2), "utf8");
console.log(`\nレポートを保存しました → ${outPath}`);

process.exit(findings.length > 0 && !FIX ? 1 : 0);
