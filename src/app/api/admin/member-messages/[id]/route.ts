import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { AUDIENCE_VALUES } from "@/lib/memberMessages";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(50_000).optional(),
  body_format: z.enum(["html", "text"]).optional(),
  tag: z.string().min(1).max(30).optional(),
  tag_color: z.string().max(100).optional(),
  channel_inapp: z.boolean().optional(),
  channel_email: z.boolean().optional(),
  audiences: z.array(z.enum(AUDIENCE_VALUES)).min(1).optional(),
  target_customer_ids: z.array(z.string().uuid()).optional(),
  image_urls: z.array(z.string().url()).optional(),
  pdf_urls: z.array(z.string().url()).optional(),
  // 'draft' に戻す / 'scheduled' に予約変更
  status: z.enum(["draft", "scheduled"]).optional(),
  scheduled_at: z.string().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("messages.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("member_messages")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "配信が見つかりません" }, { status: 404 });
  }
  // 送信済み・配信中・取消済みは編集不可（配信前のみ編集可能）
  if (!["draft", "scheduled"].includes((existing as any).status)) {
    return NextResponse.json(
      { error: "配信済み（または配信中）のメッセージは編集できません" },
      { status: 409 },
    );
  }

  const d = parsed.data;
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of [
    "title",
    "body",
    "body_format",
    "tag",
    "tag_color",
    "channel_inapp",
    "channel_email",
    "image_urls",
    "pdf_urls",
  ] as const) {
    if (d[k] !== undefined) payload[k] = d[k];
  }
  if (d.audiences !== undefined) {
    // audience（単一値）は後方互換のため先頭の選択値を保持。
    payload.audience = d.audiences[0];
    payload.audiences = d.audiences;
  }
  if (d.audiences !== undefined || d.target_customer_ids !== undefined) {
    const audiences = d.audiences ?? ((existing as any).audiences?.length ? (existing as any).audiences : [(existing as any).audience]);
    payload.target_customer_ids =
      audiences.includes("subset") ? d.target_customer_ids ?? (existing as any).target_customer_ids : [];
  }

  // チャネル整合性チェック（最低1つ）
  const inapp = d.channel_inapp ?? (existing as any).channel_inapp;
  const email = d.channel_email ?? (existing as any).channel_email;
  if (!inapp && !email) {
    return NextResponse.json({ error: "配信チャネルを1つ以上選択してください" }, { status: 400 });
  }

  if (d.status === "scheduled") {
    const raw = d.scheduled_at ?? (existing as any).scheduled_at;
    if (!raw) return NextResponse.json({ error: "予約配信日時を指定してください" }, { status: 400 });
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) {
      return NextResponse.json({ error: "予約日時の形式が不正です" }, { status: 400 });
    }
    payload.status = "scheduled";
    payload.scheduled_at = dt.toISOString();
  } else if (d.status === "draft") {
    payload.status = "draft";
    if (d.scheduled_at === null) payload.scheduled_at = null;
  } else if (d.scheduled_at !== undefined) {
    payload.scheduled_at = d.scheduled_at ? new Date(d.scheduled_at).toISOString() : null;
  }

  const { error } = await admin.from("member_messages").update(payload).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "message.update",
    targetTable: "member_messages",
    targetId: params.id,
    meta: payload,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("messages.manage");
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("member_messages")
    .select("id, title, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "配信が見つかりません" }, { status: 404 });
  }

  const { error } = await admin.from("member_messages").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "message.delete",
    targetTable: "member_messages",
    targetId: params.id,
    meta: existing,
  });

  return NextResponse.json({ ok: true });
}
