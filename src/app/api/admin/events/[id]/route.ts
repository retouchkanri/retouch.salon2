import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  type: z.enum(["visit", "private_visit"]).optional(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional().nullable(),
  capacity: z.coerce.number().int().min(0).max(10000).optional(),
  location: z.string().max(200).optional().nullable(),
  supporters_only: z.boolean().optional(),
  is_published: z.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdmin();
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("events")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }

  const payload: Record<string, any> = {};
  for (const key of [
    "type",
    "title",
    "description",
    "capacity",
    "location",
    "supporters_only",
    "is_published",
    "sort_order",
  ] as const) {
    if (parsed.data[key] !== undefined) (payload as any)[key] = parsed.data[key];
  }
  if (parsed.data.starts_at) {
    const d = new Date(parsed.data.starts_at);
    if (Number.isNaN(d.getTime()))
      return NextResponse.json({ error: "開始日時の形式が不正です" }, { status: 400 });
    payload.starts_at = d.toISOString();
  }
  if (parsed.data.ends_at !== undefined) {
    if (!parsed.data.ends_at) payload.ends_at = null;
    else {
      const d = new Date(parsed.data.ends_at);
      if (Number.isNaN(d.getTime()))
        return NextResponse.json({ error: "終了日時の形式が不正です" }, { status: 400 });
      payload.ends_at = d.toISOString();
    }
  }

  const startsAt = payload.starts_at ?? (existing as any).starts_at;
  const endsAt = payload.ends_at ?? (existing as any).ends_at;
  if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return NextResponse.json({ error: "終了日時は開始日時より後にしてください" }, { status: 400 });
  }

  const { error } = await admin.from("events").update(payload).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "event.update",
    targetTable: "events",
    targetId: params.id,
    meta: { prev: existing, next: payload },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";

  const { data: existing } = await admin
    .from("events")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }

  if (hard) {
    const { count } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("event_id", params.id);
    if (count && count > 0) {
      return NextResponse.json(
        { error: "予約レコードが存在するため完全削除できません。先にキャンセルしてください。" },
        { status: 409 },
      );
    }
    const { error } = await admin.from("events").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAudit({
      actorId: session.userId,
      action: "event.delete",
      targetTable: "events",
      targetId: params.id,
      meta: existing,
    });
    return NextResponse.json({ ok: true, hard: true });
  }

  const { error } = await admin.from("events").update({ is_published: false }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "event.unpublish",
    targetTable: "events",
    targetId: params.id,
    meta: { title: (existing as any).title },
  });

  return NextResponse.json({ ok: true });
}
