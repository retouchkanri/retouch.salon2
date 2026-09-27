/**
 * Business rules around which plans can coexist.
 * - Only one of A / B / C / OWNER can be active.
 * - SUPPORT (支援会員) cannot coexist with A/B/C/OWNER.
 * - SPECIAL_TEAM can coexist with anything.
 * - RPT (RetouchPony【リタポ】メンバー) can coexist with anything.
 */
export type PlanCode = "A" | "B" | "C" | "OWNER" | "SPECIAL_TEAM" | "SUPPORT" | "RPT";

/** 基本会員区分（管理画面手動登録・v_customer_summary の primary_plan）。Stripe 自己申込は A/B/C のみ。 */
export const BASIC_MEMBER_PLAN_CODES: PlanCode[] = ["A", "B", "C", "OWNER"];

export function isBasicMemberPlanCode(code: string | null | undefined): boolean {
  return !!code && BASIC_MEMBER_PLAN_CODES.includes(code as PlanCode);
}

/** マイページから Stripe 申込できる基本プラン（オーナーズは管理画面のみ）。 */
export const SELF_SERVICE_BASIC_PLAN_CODES = ["A", "B", "C"] as const;

/**
 * Canonical price for ONE support 口. A half share is `units = 0.5`, so a
 * support_subscription's `monthly_amount` must always equal
 * `round(SUPPORT_UNIT_PRICE * units)` → 半口 = ¥6,000, 1口 = ¥12,000.
 *
 * This is the single source of truth for support pricing. Do NOT price off the
 * 半口支援 plan's own unit_amount (¥6,000) and then multiply by 0.5 units — that
 * double-applies the "half" and yields ¥3,000. Keep in sync with the 1口支援
 * membership plan and scripts/fix-half-share-pricing.mjs.
 */
export const SUPPORT_UNIT_PRICE = 12000;

/**
 * Stripe charges support via quantity-based pricing (one shared price ×
 * quantity). Because 口数 can be 0.5 (半口), the Stripe price must use the
 * HALF-口 amount as its quantum — otherwise 半口 (monthly ¥6,000) rounds up to
 * quantity 1 of a ¥12,000 price and the member is billed the full ¥12,000.
 *
 * With a ¥6,000 quantum: 半口 → qty 1 (¥6,000), 1口 → qty 2 (¥12,000),
 * 1.5口 → qty 3 (¥18,000), … Every monthly amount is a multiple of ¥6,000,
 * so the quantity is always a clean integer.
 */
export const SUPPORT_STRIPE_QUANTUM = SUPPORT_UNIT_PRICE / 2;

export function canCoexist(existing: PlanCode[], incoming: PlanCode): { ok: boolean; reason?: string } {
  const has = (c: PlanCode) => existing.includes(c);
  const basicExclusive = BASIC_MEMBER_PLAN_CODES;

  if (basicExclusive.includes(incoming)) {
    if (basicExclusive.some((c) => has(c) && c !== incoming)) {
      return { ok: false, reason: "基本会員区分は1つのみ登録できます。変更してください。" };
    }
    if (has("SUPPORT")) {
      return { ok: false, reason: "支援会員と基本会員区分は併用できません。" };
    }
    return { ok: true };
  }
  if (incoming === "SUPPORT") {
    if (basicExclusive.some(has)) {
      return { ok: false, reason: "基本会員区分と支援会員は併用できません。" };
    }
    return { ok: true };
  }
  // SPECIAL_TEAM: always ok
  return { ok: true };
}
