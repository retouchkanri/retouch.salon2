import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * マイページでお知らせを開いた際の既読化。自分の配信先行のみ更新する。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("member_message_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("message_id", params.id)
    .eq("customer_id", session.customerId)
    .is("read_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
