import { isStaffRole, type Role } from "@/lib/roles";

/**
 * コミュニティを一般の会員に公開するか。
 *   false: 会員には表示しない（ヘッダー・スマホのボタン・マイページのカードを隠し、
 *          /community を開いても「準備中」と表示する）。運営（オーナー・管理者・モデレーター）は
 *          テスト・管理のため従来どおり利用できる。
 *   true : 会員にも公開する。
 * 2026-09-28 に非公開化し、2026-10-12 に再公開した。再公開の前に、会員が見られるチャンネルの規則
 * （supabase/migrations/20261012_community_member_access.sql）をデータベースに適用済み。
 * 別のデータベースで true にするときは、先にその SQL を適用すること（適用前は、会員がチャンネルを
 * 作成・追加でき、無料会員もお知らせ以外を閲覧できる）。
 */
export const COMMUNITY_OPEN_TO_MEMBERS = true;

/**
 * このユーザーの権限でコミュニティを表示してよいか（公開の切り替えだけを見る）。
 * 会員については、さらに有料会員かどうかを src/lib/community/access.ts の communityVisibleFor で確認する
 * （2026-10-13 から、コミュニティを利用できるのは運営と有料会員だけ）。
 */
export function canSeeCommunity(role: Role | null | undefined): boolean {
  if (!role) return false;
  return COMMUNITY_OPEN_TO_MEMBERS || isStaffRole(role);
}
