import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bookingCanceledTemplate, bookingConfirmedTemplate, notify, staffRecipients } from "@/lib/notify";
import { writeAudit } from "@/lib/audit";
import { hasActiveSupport, seatUsage } from "@/lib/bookings";
import {
  ALL_PICKUP_CODES,
  eventVenue,
  MAX_COMPANIONS,
  PICKUP_NONE,
  ridingAvailable,
  type Venue,
} from "@/lib/events";
import type { BookingCompanion } from "@/types/db";

const companionSchema = z.object({
  name: z.string().max(100),
  relation: z.enum(["family", "friend", "other"]),
});

const schema = z.object({
  event_id: z.string().uuid(),
  party_size: z.number().int().min(1).max(20).optional(),
  note: z.string().max(500).optional().nullable(),
  pickup: z.string().max(64).optional().nullable(),
  riding: z.boolean().optional(),
  companions: z.array(companionSchema).max(MAX_COMPANIONS).optional(),
});

type EventForBooking = {
  id: string;
  type: "visit" | "private_visit";
  title: string;
  location: string | null;
  starts_at: string;
  capacity: number;
  supporters_only: boolean;
  is_published: boolean;
};

type VisitInput = z.infer<typeof schema>;

/**
 * 見学会の追加項目を正規化する。
 *   - 同伴者は氏名のある先頭3件まで
 *   - 送迎は会場の有効コードのみ（希望しない／不明は null）
 *   - 体験乗馬は千葉のみ
 *   - 人数 = 申込者本人(1) + 同伴者数
 */
function normalizeVisit(venue: Venue | null, input: VisitInput) {
  const companions: BookingCompanion[] = (input.companions ?? [])
    .map((c) => ({ name: c.name.trim(), relation: c.relation }))
    .filter((c) => c.name.length > 0)
    .slice(0, MAX_COMPANIONS);
  let pickup: string | null = input.pickup ?? null;
  if (pickup === PICKUP_NONE || (pickup && !ALL_PICKUP_CODES.includes(pickup))) pickup = null;
  const riding = ridingAvailable(venue) ? Boolean(input.riding) : false;
  const party_size = 1 + companions.length;
  return { companions, pickup, riding, party_size };
}

/** 何らかの有料会員か（A/B/C・支援・RPT・特別チームのいずれか）。無料会員は false。 */
async function isPaidMember(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  customerId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("v_customer_summary")
    .select("member_class_code, rpt_active, special_team_count")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!data) return false;
  const d = data as any;
  return Boolean(
    d.member_class_code || d.rpt_active || Number(d.special_team_count ?? 0) > 0,
  );
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: ev } = await admin
    .from("events")
    .select("id, type, title, location, starts_at, capacity, supporters_only, is_published")
    .eq("id", parsed.data.event_id)
    .maybeSingle();
  if (!ev || !(ev as any).is_published) {
    return NextResponse.json({ error: "対象のイベントが見つかりません" }, { status: 404 });
  }
  const event = ev as EventForBooking;
  const isVisit = event.type === "visit";

  // 見学会は会員限定（無料会員は除外）。
  if (isVisit && !(await isPaidMember(admin, session.customerId))) {
    return NextResponse.json(
      { error: "見学会のご予約は会員様限定です。会員登録後にお申し込みください。" },
      { status: 403 },
    );
  }

  if (event.supporters_only) {
    const ok = await hasActiveSupport(admin as any, session.customerId);
    if (!ok) return NextResponse.json({ error: "このイベントは支援者限定です" }, { status: 403 });
  }

  const venue = eventVenue(event);
  const visit = normalizeVisit(venue, parsed.data);
  const partySize = isVisit ? visit.party_size : parsed.data.party_size ?? 1;
  const note = parsed.data.note ?? null;
  const pickup = isVisit ? visit.pickup : null;
  const riding = isVisit ? visit.riding : false;
  const companions = isVisit ? visit.companions : [];

  const usage = await seatUsage(admin as any, event);
  if (usage.used + partySize > usage.capacity) {
    return NextResponse.json({ error: "定員を超えるため予約できません" }, { status: 409 });
  }

  const { data: existing } = await admin
    .from("bookings")
    .select("id, status")
    .eq("customer_id", session.customerId)
    .eq("event_id", event.id)
    .maybeSingle();

  if (existing && (existing as any).status !== "canceled") {
    return NextResponse.json({ error: "すでにこのイベントを予約しています" }, { status: 409 });
  }

  const fields = {
    party_size: partySize,
    note,
    pickup,
    riding,
    companions,
  };

  let bookingId: string | null = null;
  if (existing) {
    const { data: updated, error } = await admin
      .from("bookings")
      .update({
        status: "reserved",
        canceled_at: null,
        booked_at: new Date().toISOString(),
        ...fields,
      })
      .eq("id", (existing as any).id)
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    bookingId = updated?.id ?? null;
  } else {
    const { data: inserted, error } = await admin
      .from("bookings")
      .insert({
        customer_id: session.customerId,
        event_id: event.id,
        status: "reserved",
        ...fields,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    bookingId = inserted?.id ?? null;
  }

  await writeAudit({
    actorId: session.userId,
    action: "booking.self_create",
    targetTable: "bookings",
    targetId: bookingId,
    meta: {
      event_id: event.id,
      event_title: event.title,
      party_size: partySize,
      note,
      pickup,
      riding,
      companions,
    },
  });

  const { data: cust } = await admin
    .from("customers")
    .select("full_name, email")
    .eq("id", session.customerId)
    .maybeSingle();
  const tpl = bookingConfirmedTemplate({
    name: (cust as any)?.full_name ?? null,
    eventTitle: event.title,
    startsAt: event.starts_at,
    venue,
    pickup,
    riding,
    companions,
  });
  await notify({
    kind: "booking_confirmed",
    to: (cust as any)?.email ?? session.email,
    to_name: (cust as any)?.full_name ?? null,
    subject: tpl.subject,
    body_text: tpl.body_text,
    meta: { event_id: event.id, party_size: partySize },
  });

  // スタッフへの予約申込通知
  {
    const d = new Date(event.starts_at);
    const when = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const custName = (cust as any)?.full_name ?? "（不明）";
    const custEmail = (cust as any)?.email ?? session.email;
    const pickupText = pickup ? `\n・送迎: ${pickup}` : "";
    const companionsText = companions.length > 0 ? `\n・同伴者: ${companions.length}名` : "";
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【見学会・面会 予約申込】${custName} — ${event.title}`,
      body_text:
        `見学会・面会の予約申込が入りました。\n\n` +
        `・会員名: ${custName}\n` +
        `・メール: ${custEmail}\n` +
        `・イベント: ${event.title}\n` +
        `・日時: ${when}\n` +
        `・人数: ${partySize}名` +
        pickupText +
        companionsText,
      reply_to: custEmail,
      meta: { event_id: event.id, booking_id: bookingId, source: "booking_create" },
    });
  }

  return NextResponse.json({ ok: true, id: bookingId });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("bookings")
    .select("id, status, party_size, note, pickup, riding, companions")
    .eq("customer_id", session.customerId)
    .eq("event_id", parsed.data.event_id)
    .maybeSingle();
  if (!existing || (existing as any).status === "canceled") {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }

  const { data: ev } = await admin
    .from("events")
    .select("id, type, title, location, starts_at, capacity, supporters_only, is_published")
    .eq("id", parsed.data.event_id)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  const event = ev as EventForBooking;
  const isVisit = event.type === "visit";
  const venue = eventVenue(event);
  const visit = normalizeVisit(venue, parsed.data);

  const update: Record<string, unknown> = {};
  if (isVisit) {
    update.party_size = visit.party_size;
    update.pickup = visit.pickup;
    update.riding = visit.riding;
    update.companions = visit.companions;
  } else if (parsed.data.party_size !== undefined) {
    update.party_size = parsed.data.party_size;
  }
  if (parsed.data.note !== undefined) update.note = parsed.data.note;

  const nextPartySize = update.party_size as number | undefined;
  if (nextPartySize !== undefined) {
    const usage = await seatUsage(admin as any, event, session.customerId);
    if (usage.used + nextPartySize > usage.capacity) {
      return NextResponse.json({ error: "定員を超えるため変更できません" }, { status: 409 });
    }
  }

  const { error } = await admin
    .from("bookings")
    .update(update)
    .eq("id", (existing as any).id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "booking.self_update",
    targetTable: "bookings",
    targetId: (existing as any).id,
    meta: {
      event_id: parsed.data.event_id,
      prev: {
        party_size: (existing as any).party_size,
        note: (existing as any).note,
        pickup: (existing as any).pickup,
        riding: (existing as any).riding,
        companions: (existing as any).companions,
      },
      next: update,
    },
  });

  // スタッフへの予約変更通知
  {
    const { data: cust } = await admin
      .from("customers")
      .select("full_name, email")
      .eq("id", session.customerId)
      .maybeSingle();
    const d = new Date(event.starts_at);
    const when = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const custName = (cust as any)?.full_name ?? "（不明）";
    const custEmail = (cust as any)?.email ?? session.email;
    const newPartySize = (update.party_size as number | undefined) ?? (existing as any).party_size;
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【見学会・面会 予約変更】${custName} — ${event.title}`,
      body_text:
        `見学会・面会の予約内容が変更されました。\n\n` +
        `・会員名: ${custName}\n` +
        `・メール: ${custEmail}\n` +
        `・イベント: ${event.title}\n` +
        `・日時: ${when}\n` +
        `・変更後人数: ${newPartySize}名`,
      reply_to: custEmail,
      meta: { event_id: parsed.data.event_id, booking_id: (existing as any).id, source: "booking_update" },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("bookings")
    .select("id, party_size")
    .eq("customer_id", session.customerId)
    .eq("event_id", parsed.data.event_id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }

  const { error } = await admin
    .from("bookings")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", (existing as any).id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "booking.self_cancel",
    targetTable: "bookings",
    targetId: (existing as any).id,
    meta: { event_id: parsed.data.event_id, party_size: (existing as any).party_size },
  });

  // キャンセル確認メール + スタッフ通知
  const [{ data: cancelCust }, { data: cancelEv }] = await Promise.all([
    admin.from("customers").select("full_name, email").eq("id", session.customerId).maybeSingle(),
    admin.from("events").select("title, starts_at").eq("id", parsed.data.event_id).maybeSingle(),
  ]);
  if (cancelEv) {
    const cancelTpl = bookingCanceledTemplate({
      name: (cancelCust as any)?.full_name ?? null,
      eventTitle: (cancelEv as any).title,
      startsAt: (cancelEv as any).starts_at,
    });
    await notify({
      kind: "booking_canceled",
      to: (cancelCust as any)?.email ?? session.email,
      to_name: (cancelCust as any)?.full_name ?? null,
      subject: cancelTpl.subject,
      body_text: cancelTpl.body_text,
      meta: { event_id: parsed.data.event_id, booking_id: (existing as any).id },
    });
  }
  {
    const custName = (cancelCust as any)?.full_name ?? "（不明）";
    const custEmail = (cancelCust as any)?.email ?? session.email;
    const evTitle = (cancelEv as any)?.title ?? "（不明）";
    const d = new Date((cancelEv as any)?.starts_at ?? "");
    const when = Number.isNaN(d.getTime())
      ? ""
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【見学会・面会 予約キャンセル】${custName} — ${evTitle}`,
      body_text:
        `見学会・面会の予約がキャンセルされました。\n\n` +
        `・会員名: ${custName}\n` +
        `・メール: ${custEmail}\n` +
        `・イベント: ${evTitle}` +
        (when ? `\n・日時: ${when}` : ""),
      reply_to: custEmail,
      meta: { event_id: parsed.data.event_id, booking_id: (existing as any).id, source: "booking_cancel" },
    });
  }

  return NextResponse.json({ ok: true });
}
