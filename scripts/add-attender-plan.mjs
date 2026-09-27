// アテンダー会員プラン（無償・Stripeなし・管理画面から手動付与）を追加する。
//   高額寄付者への感謝として、無料登録会員から手動で「アテンダー会員」へ
//   変更できるようにするためのプラン。オーナーズ会員(OWNER, ¥0)と同様の無料枠。
//   会員種別の表示は plan 名（v_customer_summary.primary_plan_name）で行われるため、
//   code は既存の 'A' を流用（ビュー改修不要）。月額は¥0（月額合計に加算されない）。
//   会員側のセルフ加入は別途コードでブロック（¥0プランは self-service 不可）。
//   冪等。
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// is_active で絞らずに既存行を探す。無効化されて残っているとここで拾い、
// 重複INSERTせずに再有効化する（過去に無効行が残り再実行で重複した不具合の対策）。
const { data: existing } = await sb
  .from("membership_plans")
  .select("id, is_active")
  .eq("code", "A")
  .eq("name", "アテンダー会員")
  .eq("monthly_amount", 0)
  .maybeSingle();

if (existing) {
  if (existing.is_active) {
    console.log("既に存在します:", existing.id);
    process.exit(0);
  }
  const { error: reErr } = await sb
    .from("membership_plans")
    .update({ is_active: true })
    .eq("id", existing.id);
  if (reErr) { console.error("再有効化失敗:", reErr.message); process.exit(1); }
  console.log("再有効化しました:", existing.id);
  process.exit(0);
}

const { data, error } = await sb
  .from("membership_plans")
  .insert({
    code: "A",
    name: "アテンダー会員",
    monthly_amount: 0,
    unit_amount: null,
    allow_with_support: false,
    allow_with_team: true,
    sort_order: 12,
    description: "高額寄付者向けの無償アテンダー会員（決済・Stripeなし・管理画面から手動付与）",
    is_active: true,
  })
  .select("id")
  .single();

if (error) { console.error("挿入失敗:", error.message); process.exit(1); }
console.log("作成しました:", data.id);
process.exit(0);
