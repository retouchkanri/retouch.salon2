import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { hasActiveSupport } from "@/lib/bookings";
import {
  HORSE_MEETING_ARRIVAL_METHODS,
  HORSE_MEETING_FACILITIES,
  HORSE_MEETING_TIME_SLOTS,
  horseMeetingFacilityLabel,
} from "@/lib/horseMeetings";
import { horseMeetingReceivedTemplate, notify, staffRecipients } from "@/lib/notify";

const facilityValues = HORSE_MEETING_FACILITIES.map((f) => f.value) as [string, ...string[]];
const timeSlotValues = [...HORSE_MEETING_TIME_SLOTS] as [string, ...string[]];
const arrivalValues = HORSE_MEETING_ARRIVAL_METHODS.map((a) => a.value) as [string, ...string[]];

const createSchema = z.object({
  applicant_name: z.string().trim().min(1, "お名前を入力してください").max(120),
  facility: z.enum(facilityValues),
  party_size: z.coerce.number().int().min(1).max(20),
  preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "希望日を選択してください"),
  preferred_time_slot: z.enum(timeSlotValues),
  supported_horses: z.string().trim().min(1, "支援対象馬を入力してください").max(2000),
  arrival_method: z.enum(arrivalValues),
  pickup_time: z.string().max(120).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

export async function GET() {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("horse_meeting_requests")
    .select("*")
    .eq("customer_id", session.customerId)
    .order("requested_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const ok = await hasActiveSupport(admin as any, session.customerId);
  if (!ok) {
    return NextResponse.json(
      { error: "馬の面会は、半口以上の支援会員様限定です。支援登録後にお申し込みください。" },
      { status: 403 },
    );
  }

  const { arrival_method, pickup_time, ...rest } = parsed.data;
  if (arrival_method !== "car" && !pickup_time?.trim()) {
    return NextResponse.json({ error: "お迎え希望の場合は希望時刻を入力してください" }, { status: 400 });
  }

  const { data: inserted, error } = await admin
    .from("horse_meeting_requests")
    .insert({
      customer_id: session.customerId,
      ...rest,
      arrival_method,
      pickup_time: arrival_method === "car" ? null : pickup_time?.trim() ?? null,
      note: rest.note?.trim() || null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? "申込に失敗しました" }, { status: 500 });
  }

  const { data: customer } = await admin
    .from("customers")
    .select("full_name, email")
    .eq("id", session.customerId)
    .maybeSingle();

  await writeAudit({
    actorId: session.userId,
    action: "horse_meeting.create",
    targetTable: "horse_meeting_requests",
    targetId: inserted.id,
    meta: parsed.data,
  });

  await notify({
    kind: "staff_notify",
    to: staffRecipients(),
    subject: `【馬の面会 申込】${parsed.data.applicant_name}`,
    body_text:
      `馬の面会のお申し込みがありました。\n\n` +
      `・お名前: ${parsed.data.applicant_name}\n` +
      `・会員: ${(customer as any)?.full_name ?? "—"} (${(customer as any)?.email ?? "—"})\n` +
      `・施設: ${parsed.data.facility}\n` +
      `・希望: ${parsed.data.preferred_date} ${parsed.data.preferred_time_slot}\n` +
      `・人数: ${parsed.data.party_size}名\n` +
      `・支援馬: ${parsed.data.supported_horses}`,
    reply_to: (customer as any)?.email ?? undefined,
    meta: { request_id: inserted.id, source: "horse_meeting" },
  });

  // 会員本人への受付確認メール（送信に失敗しても申込自体は成功とする）
  const memberEmail = (customer as any)?.email as string | null | undefined;
  if (memberEmail) {
    const memberTpl = horseMeetingReceivedTemplate({
      name: (customer as any)?.full_name ?? parsed.data.applicant_name,
      facility: horseMeetingFacilityLabel(parsed.data.facility),
      preferredDate: parsed.data.preferred_date,
      timeSlot: parsed.data.preferred_time_slot,
      partySize: parsed.data.party_size,
      supportedHorses: parsed.data.supported_horses,
    });
    await notify({
      kind: "horse_meeting_received",
      to: memberEmail,
      to_name: (customer as any)?.full_name ?? parsed.data.applicant_name,
      subject: memberTpl.subject,
      body_text: memberTpl.body_text,
      meta: { request_id: inserted.id, source: "horse_meeting" },
    });
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
