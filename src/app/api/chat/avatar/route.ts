import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveAvatarUrl } from "@/lib/avatars";
import { ADMIN_AVATAR_URL } from "@/lib/avatarUrls";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** チャットUI用：ログイン中は会員アバター、未ログインは管理者デフォルトを返す。 */
export async function GET() {
  const adminAvatarUrl = ADMIN_AVATAR_URL;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ loggedIn: false, avatarUrl: adminAvatarUrl });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("customers")
      .select("avatar_url")
      .eq("auth_user_id", session.userId)
      .maybeSingle();

    const avatarUrl =
      resolveAvatarUrl(session.role, (data?.avatar_url as string | null) ?? null) ??
      adminAvatarUrl;

    return NextResponse.json({ loggedIn: true, avatarUrl });
  } catch {
    return NextResponse.json({ loggedIn: true, avatarUrl: adminAvatarUrl });
  }
}
