import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import {
  channelErrorMessage,
  channelInputSchema,
  normalizeChannelInput,
  removeChannelFiles,
} from "@/lib/community/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** チャンネルの更新（アーカイブを含む）。 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const parsed = channelInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const row = await normalizeChannelInput(admin, parsed.data);
  const { data, error } = await admin
    .from("community_channels")
    .update(row)
    .eq("id", params.id)
    .eq("kind", "channel")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: channelErrorMessage(error) }, { status: 400 });
  if (!data) return NextResponse.json({ error: "チャンネルが見つかりません" }, { status: 404 });

  await writeAudit({
    actorId: session.userId,
    action: "community.channel_update",
    targetTable: "community_channels",
    targetId: params.id,
    meta: { name: row.name, visibility: row.visibility, audience: row.audience, is_archived: row.is_archived ?? null },
  });
  return NextResponse.json({ ok: true });
}

/** チャンネルの削除（メッセージ・添付ファイルもすべて削除）。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: ch } = await admin
    .from("community_channels")
    .select("id, name, kind")
    .eq("id", params.id)
    .maybeSingle();
  if (!ch || ch.kind !== "channel") return NextResponse.json({ error: "チャンネルが見つかりません" }, { status: 404 });

  const { count } = await admin
    .from("community_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", params.id);
  const { error } = await admin.from("community_channels").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await removeChannelFiles(admin, params.id);

  await writeAudit({
    actorId: session.userId,
    action: "community.channel_delete",
    targetTable: "community_channels",
    targetId: params.id,
    meta: { name: ch.name, deleted_messages: count ?? null },
  });
  return NextResponse.json({ ok: true });
}
