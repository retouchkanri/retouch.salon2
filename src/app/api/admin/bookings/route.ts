import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { hasActiveSupport, seatUsage } from "@/lib/bookings";
import { bookingConfirmedTemplate, notify, staffRecipients } from "@/lib/notify";

const schema = z.object({
  customer_id: z.string().uuid(),
  event_id: z.string().uuid(),
  party_size: z.coerce.number().int().positive().max(20).default(1),
  note: z.string().max(500).optional().nullable(),
  status: z
    .enum(["reserved", "canceled", "attended", "no_show"])
    .default("reserved"),
  /** When true, admin overrides supporters_only / capacity guards. Default false. */
  bypass_guard: z.boolean().optional(),
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
  const admin = createSupabaseAdminClient();

  const { data: ev } = await admin
    .from("events")
    .select("id, title, starts_at, capacity, supporters_only")
    .eq("id", parsed.data.event_id)
    .maybeSingle();
  if (!ev) {
    return NextResponse.json({ error: "対象のイベントが見つかりません" }, { status: 404 });
  }

  if (!parsed.data.bypass_guard) {
    if ((ev as any).supporters_only) {
      const ok = await hasActiveSupport(admin as any, parsed.data.customer_id);
      if (!ok)
        return NextResponse.json(
          { error: "対象顧客は支援者ではありません（管理者権限で強制登録する場合は bypass_guard を有効化）" },
          { status: 409 },
        );
    }
    if (parsed.data.status !== "canceled") {
      const usage = await seatUsage(admin as any, ev as any);
      if (usage.used + parsed.data.party_size > usage.capacity) {
        return NextResponse.json(
          { error: "定員を超えるため登録できません（管理者権限で強制登録する場合は bypass_guard を有効化）" },
          { status: 409 },
        );
      }
    }
  }

  const { data: existing } = await admin
    .from("bookings")
    .select("id")
    .eq("customer_id", parsed.data.customer_id)
    .eq("event_id", parsed.data.event_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "既に予約が登録されています" }, { status: 400 });
  }

  // Strip `bypass_guard` — it's a control flag, not a column.
  const { bypass_guard: _bypass, ...insertPayload } = parsed.data;

  const { data: inserted, error } = await admin
    .from("bookings")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "booking.create",
    targetTable: "bookings",
    targetId: inserted.id,
    meta: insertPayload,
  });

  // 実際の予約（reserved）のみ、会員本人・運営へ申込受付を通知する。
  // attended / no_show / canceled での登録時は通知しない。送信失敗は登録に影響させない。
  if (parsed.data.status === "reserved") {
    const { data: customer } = await admin
      .from("customers")
      .select("full_name, email")
      .eq("id", parsed.data.customer_id)
      .maybeSingle();
    const memberEmail = (customer as any)?.email as string | null | undefined;
    const memberName = (customer as any)?.full_name as string | null;
    const eventTitle = (ev as any)?.title ?? "見学会";
    const startsAt = (ev as any)?.starts_at ?? "";

    if (memberEmail) {
      const memberTpl = bookingConfirmedTemplate({
        name: memberName,
        eventTitle,
        startsAt,
      });
      await notify({
        kind: "booking_confirmed",
        to: memberEmail,
        to_name: memberName,
        subject: memberTpl.subject,
        body_text: memberTpl.body_text,
        meta: { booking_id: inserted.id, event_id: parsed.data.event_id, source: "admin_booking_create" },
      });
    }

    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【見学申込 登録】${memberName ?? "会員"} — ${eventTitle}`,
      body_text:
        `運営にて見学会の予約を登録しました。\n\n` +
        `・会員名: ${memberName ?? "—"}\n` +
        `・メール: ${memberEmail ?? "—"}\n` +
        `・イベント: ${eventTitle}\n` +
        `・人数: ${parsed.data.party_size}名`,
      reply_to: memberEmail ?? undefined,
      meta: { booking_id: inserted.id, event_id: parsed.data.event_id, source: "admin_booking_create" },
    });
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
