import { NextResponse } from "next/server";
import type { SessionInfo } from "@/lib/auth";
import { isStaffRole } from "@/lib/roles";
import { MEMBER_SELF_SERVICE_ENABLED, MEMBER_PLAN_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";

/**
 * 会員（マイページ）からの追加・変更・削除を一元的に拒否するためのガード。
 *
 * 運用方針の変更により、各種お手続きは管理者が管理画面から行うため、
 * {@link MEMBER_SELF_SERVICE_ENABLED} が false の間は、スタッフ以外
 * （= 会員ロール）からのミューテーション API を 403 で拒否する。
 *
 * 各ミューテーション API のハンドラ先頭（認証チェックの直後）で呼び出し、
 * 返り値が NextResponse の場合はそのまま return することで遮断する。
 */
export const MEMBER_MUTATION_FORBIDDEN_MESSAGE =
  "各種お手続き（追加・変更・停止）は運営にて承っております。お手数ですが運営までお問い合わせください。";

/**
 * スタッフ以外による操作を拒否すべき場合に 403 レスポンスを返す。
 * 操作を許可してよい場合は null を返す。
 */
export function memberMutationGuard(session: SessionInfo): NextResponse | null {
  if (MEMBER_SELF_SERVICE_ENABLED) return null;
  if (isStaffRole(session.role)) return null;
  return NextResponse.json(
    { error: MEMBER_MUTATION_FORBIDDEN_MESSAGE },
    { status: 403 },
  );
}

/**
 * 会員種別（有料の基本会員 A/B/C）への入会・変更・停止専用のガード。
 *
 * 包括的なセルフサービス制限（{@link memberMutationGuard}）とは独立し、
 * {@link MEMBER_PLAN_SELF_SERVICE_ENABLED} が有効な間は会員自身の手続きを許可する。
 * 無料会員が有料の会員種別へ入会できるようにするためのもの。
 */
export function memberPlanMutationGuard(session: SessionInfo): NextResponse | null {
  if (MEMBER_PLAN_SELF_SERVICE_ENABLED) return null;
  if (isStaffRole(session.role)) return null;
  return NextResponse.json(
    { error: MEMBER_MUTATION_FORBIDDEN_MESSAGE },
    { status: 403 },
  );
}
