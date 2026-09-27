import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { moderateDeleteMessage } from "@/lib/community/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 運営によるメッセージの削除（通報対応。DM のメッセージも対象）。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  try {
    const found = await moderateDeleteMessage(admin, params.id, session.userId);
    if (!found) return NextResponse.json({ error: "メッセージが見つかりません" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "削除できませんでした" }, { status: 500 });
  }
  await writeAudit({
    actorId: session.userId,
    action: "community.message_delete",
    targetTable: "community_messages",
    targetId: params.id,
  });
  return NextResponse.json({ ok: true });
}
