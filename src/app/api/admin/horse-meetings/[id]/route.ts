import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { HORSE_MEETING_STATUSES } from "@/lib/horseMeetings";

const patchSchema = z.object({
  status: z.enum(HORSE_MEETING_STATUSES).optional(),
  admin_note: z.string().max(2000).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("bookings.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (parsed.data.status === "canceled") {
    patch.canceled_at = new Date().toISOString();
  }
  const { error } = await admin.from("horse_meeting_requests").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "horse_meeting.update",
    targetTable: "horse_meeting_requests",
    targetId: params.id,
    meta: parsed.data,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("bookings.manage");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("horse_meeting_requests").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "horse_meeting.delete",
    targetTable: "horse_meeting_requests",
    targetId: params.id,
  });

  return NextResponse.json({ ok: true });
}
