import { canSeeCommunity } from "@/lib/community/visibility";
import { isStaffRole, type Role } from "@/lib/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * ログイン中のユーザーにコミュニティへの導線（ヘッダー・スマホのボタン・マイページのカード）を出すか。
 * 運営は常に出す。会員は、コミュニティを利用できる有料会員（会員種別のある会員）だけ。
 * 判定はデータベースの community_viewer_is_member（community__is_active_user と同じ規則）に任せる。
 * 確認できなかったときは出さない（開いても「ご利用いただけません」になる導線を見せないため）。
 */
export async function communityVisibleFor(role: Role | null | undefined): Promise<boolean> {
  if (!role || !canSeeCommunity(role)) return false;
  if (isStaffRole(role)) return true;
  try {
    const { data, error } = await createSupabaseServerClient().rpc("community_viewer_is_member");
    return !error && data === true;
  } catch {
    return false;
  }
}
