import { NextResponse } from "next/server";
import { communityUser } from "@/lib/community/files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SHOW_EMAIL_KEY, isEmailPublic } from "@/lib/community/emailVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 自分のメールアドレスの公開設定と、公開されるメールアドレス */
export async function GET() {
  const auth = await communityUser();
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const { data } = await admin.auth.admin.getUserById(auth.userId);
  const { data: cust } = await admin
    .from("customers")
    .select("email")
    .eq("auth_user_id", auth.userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return NextResponse.json(
    {
      show: isEmailPublic(data?.user?.user_metadata),
      email: (cust?.email as string | null | undefined)?.trim() || data?.user?.email || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** 公開・非公開を切り替える（{ show: boolean }） */
export async function POST(req: Request) {
  const auth = await communityUser();
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.show !== "boolean") {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const { data } = await admin.auth.admin.getUserById(auth.userId);
  const meta = { ...(data?.user?.user_metadata ?? {}), [SHOW_EMAIL_KEY]: body.show };
  const { error } = await admin.auth.admin.updateUserById(auth.userId, { user_metadata: meta });
  if (error) return NextResponse.json({ error: "設定を保存できませんでした。" }, { status: 500 });
  return NextResponse.json({ ok: true, show: body.show });
}
