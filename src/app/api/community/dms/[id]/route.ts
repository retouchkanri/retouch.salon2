import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { removeChannelFiles } from "@/lib/community/admin";
import { isStaffRole } from "@/lib/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ダイレクトメッセージの削除（運営のみ。メッセージ・添付ファイルは相手側を含めてすべて削除する）。
 * 運営であっても他人同士の DM は扱えない（自分が参加している DM だけ）。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  if (!isStaffRole(session.role)) {
    return NextResponse.json({ error: "ダイレクトメッセージを削除できるのは運営のみです。" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: ch } = await admin.from("community_channels").select("id, kind").eq("id", params.id).maybeSingle();
  if (!ch || ch.kind !== "dm") {
    return NextResponse.json({ error: "ダイレクトメッセージが見つかりません。" }, { status: 404 });
  }
  const { data: members, error: membersError } = await admin
    .from("community_channel_members")
    .select("user_id")
    .eq("channel_id", params.id);
  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 });
  const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (!userIds.includes(session.userId)) {
    return NextResponse.json({ error: "ダイレクトメッセージが見つかりません。" }, { status: 404 });
  }

  const { count } = await admin
    .from("community_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", params.id);
  const { error } = await admin.from("community_channels").delete().eq("id", params.id).eq("kind", "dm");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await removeChannelFiles(admin, params.id);

  await writeAudit({
    actorId: session.userId,
    action: "community.dm_delete",
    targetTable: "community_channels",
    targetId: params.id,
    meta: { with: userIds.filter((id) => id !== session.userId), deleted_messages: count ?? null },
  });
  return NextResponse.json({ ok: true });
}
