import { isStaffRole, type Role } from "@/lib/roles";

/**
 * コミュニティを一般の会員に公開するか。
 *   false: 会員には表示しない（ヘッダー・スマホのボタン・マイページのカードを隠し、
 *          /community を開いても「準備中」と表示する）。運営（オーナー・管理者・モデレーター）は
 *          テスト・管理のため従来どおり利用できる。
 *   true : 会員にも公開する。
 * 公開を再開するときは true に変えるだけでよい（2026-09-28 に非公開化）。
 */
export const COMMUNITY_OPEN_TO_MEMBERS = false;

/** このユーザーにコミュニティを表示するか */
export function canSeeCommunity(role: Role | null | undefined): boolean {
  if (!role) return false;
  return COMMUNITY_OPEN_TO_MEMBERS || isStaffRole(role);
}
