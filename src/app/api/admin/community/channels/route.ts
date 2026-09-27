import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { channelErrorMessage, channelInputSchema, normalizeChannelInput } from "@/lib/community/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** チャンネルの作成。 */
export async function POST(req: Request) {
  const session = await requireCapability("community.manage");
  const parsed = channelInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const row = await normalizeChannelInput(admin, parsed.data);
  const { data, error } = await admin
    .from("community_channels")
    .insert({ ...row, kind: "channel", is_archived: false, created_by: session.userId })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: channelErrorMessage(error) }, { status: 400 });

  await writeAudit({
    actorId: session.userId,
    action: "community.channel_create",
    targetTable: "community_channels",
    targetId: data.id,
    meta: { name: row.name, visibility: row.visibility, audience: row.audience },
  });
  return NextResponse.json({ ok: true, id: data.id });
}
