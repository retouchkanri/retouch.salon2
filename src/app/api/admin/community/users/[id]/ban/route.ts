import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
  // null = 無期限
  days: z.number().int().min(1).max(3650).nullable(),
});

/** コミュニティの利用停止。 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  if (params.id === session.userId) return NextResponse.json({ error: "自分自身は停止できません" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", params.id).maybeSingle();
  if (profile && ["owner", "admin", "moderator"].includes(String(profile.role))) {
    return NextResponse.json({ error: "運営アカウントは停止できません" }, { status: 400 });
  }

  const until = parsed.data.days ? new Date(Date.now() + parsed.data.days * 86_400_000).toISOString() : null;
  const { error } = await admin.from("community_bans").upsert(
    {
      user_id: params.id,
      reason: parsed.data.reason || null,
      until,
      created_by: session.userId,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "community.user_ban",
    targetTable: "community_bans",
    targetId: params.id,
    meta: { reason: parsed.data.reason || null, until },
  });
  return NextResponse.json({ ok: true });
}

/** 利用停止の解除。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("community_bans").delete().eq("user_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "community.user_unban",
    targetTable: "community_bans",
    targetId: params.id,
  });
  return NextResponse.json({ ok: true });
}
