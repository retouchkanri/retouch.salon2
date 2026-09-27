import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  type: z.enum(["visit", "private_visit"]).default("visit"),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  starts_at: z.string().min(1),
  ends_at: z.string().optional().nullable(),
  capacity: z.coerce.number().int().min(0).max(10000).default(0),
  location: z.string().max(200).optional().nullable(),
  supporters_only: z.boolean().optional().default(false),
  is_published: z.boolean().optional().default(true),
  sort_order: z.coerce.number().int().min(0).max(9999).optional().default(0),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const startsAt = new Date(parsed.data.starts_at);
  const endsAt = parsed.data.ends_at ? new Date(parsed.data.ends_at) : null;
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: "開始日時の形式が不正です" }, { status: 400 });
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    return NextResponse.json({ error: "終了日時の形式が不正です" }, { status: 400 });
  }
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return NextResponse.json({ error: "終了日時は開始日時より後にしてください" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const payload = {
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt ? endsAt.toISOString() : null,
    capacity: parsed.data.capacity,
    location: parsed.data.location || null,
    supporters_only: parsed.data.supporters_only,
    is_published: parsed.data.is_published,
    sort_order: parsed.data.sort_order ?? 0,
  };
  const { error, data } = await admin
    .from("events")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "event.create",
    targetTable: "events",
    targetId: data.id,
    meta: payload,
  });

  return NextResponse.json({ ok: true, id: data.id });
}
