import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ status: z.enum(["open", "resolved", "dismissed"]) });

/** 通報の対応状況を更新する。 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const closed = parsed.data.status !== "open";
  const { data, error } = await admin
    .from("community_reports")
    .update({
      status: parsed.data.status,
      resolved_by: closed ? session.userId : null,
      resolved_at: closed ? new Date().toISOString() : null,
    })
    .eq("id", params.id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "通報が見つかりません" }, { status: 404 });

  await writeAudit({
    actorId: session.userId,
    action: "community.report_update",
    targetTable: "community_reports",
    targetId: params.id,
    meta: { status: parsed.data.status },
  });
  return NextResponse.json({ ok: true });
}
