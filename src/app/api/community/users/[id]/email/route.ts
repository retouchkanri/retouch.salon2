import { NextResponse } from "next/server";
import { communityUser } from "@/lib/community/files";
import { isEmailPublic } from "@/lib/community/emailVisibility";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * コミュニティのプロフィール画面に出す、会員のメールアドレス。
 *   - 運営: 常に確認できる（公開設定にかかわらず）
 *   - 会員: 本人が「メールアドレスを公開する」を選んでいる場合のみ
 * 会員情報（customers）のメールを優先し、無ければログイン用アカウント（auth.users）のメールを返す。
 * 戻り値: { email: string | null, public: boolean }
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  const auth = await communityUser();
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const { data: me } = await admin.from("profiles").select("role").eq("id", auth.userId).maybeSingle();
  const staff = !!me && ["owner", "admin", "moderator"].includes(String(me.role));

  const { data: target } = await admin.auth.admin.getUserById(params.id);
  if (!target?.user) return NextResponse.json({ email: null, public: false });
  const isPublic = isEmailPublic(target.user.user_metadata);

  if (!staff) {
    if (!isPublic) return NextResponse.json({ email: null, public: false }, { headers: { "Cache-Control": "no-store" } });
    // 会員どうしで見られるのは、コミュニティを利用できる会員だけ
    const { data: ok } = await auth.db.rpc("community_viewer_is_member");
    if (ok !== true) return NextResponse.json({ error: "コミュニティを利用できません。" }, { status: 403 });
  }

  const { data: cust } = await admin
    .from("customers")
    .select("email")
    .eq("auth_user_id", params.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const email = (cust?.email as string | null | undefined)?.trim() || target.user.email || null;
  return NextResponse.json({ email, public: isPublic }, { headers: { "Cache-Control": "no-store" } });
}
