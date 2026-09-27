import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { seatUsage } from "@/lib/bookings";

const patchSchema = z.object({
  party_size: z.coerce.number().int().positive().max(20).optional(),
  note: z.string().max(500).optional().nullable(),
  status: z.enum(["reserved", "canceled", "attended", "no_show"]).optional(),
  bypass_guard: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdmin();
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("bookings")
    .select("id, customer_id, event_id, party_size, status, note")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }

  if (
    !parsed.data.bypass_guard &&
    parsed.data.party_size !== undefined &&
    parsed.data.party_size !== (existing as any).party_size
  ) {
    const { data: ev } = await admin
      .from("events")
      .select("id, capacity")
      .eq("id", (existing as any).event_id)
      .maybeSingle();
    if (ev) {
      const usage = await seatUsage(admin as any, ev as any, (existing as any).customer_id);
      if (usage.used + parsed.data.party_size > usage.capacity) {
        return NextResponse.json(
          { error: "定員を超えるため変更できません（bypass_guard を有効にすると上書き可能）" },
          { status: 409 },
        );
      }
    }
  }

  const { bypass_guard: _bypass, ...patchData } = parsed.data;
  const patch: Record<string, any> = { ...patchData };
  if (parsed.data.status === "canceled") patch.canceled_at = new Date().toISOString();
  if (parsed.data.status && parsed.data.status !== "canceled" && (existing as any).status === "canceled") {
    patch.canceled_at = null;
    patch.booked_at = new Date().toISOString();
  }

  const { error } = await admin.from("bookings").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "booking.update",
    targetTable: "bookings",
    targetId: params.id,
    meta: {
      event_id: (existing as any).event_id,
      prev: {
        party_size: (existing as any).party_size,
        status: (existing as any).status,
        note: (existing as any).note,
      },
      next: patch,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";

  const { data: existing } = await admin
    .from("bookings")
    .select("id, customer_id, event_id, party_size, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }

  if (hard) {
    const { error } = await admin.from("bookings").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAudit({
      actorId: session.userId,
      action: "booking.delete",
      targetTable: "bookings",
      targetId: params.id,
      meta: existing,
    });
    return NextResponse.json({ ok: true, hard: true });
  }

  const { error } = await admin
    .from("bookings")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "booking.cancel",
    targetTable: "bookings",
    targetId: params.id,
    meta: { event_id: (existing as any).event_id, party_size: (existing as any).party_size },
  });

  return NextResponse.json({ ok: true });
}
