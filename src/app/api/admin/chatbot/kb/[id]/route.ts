import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { generateKbEmbedding, getChatSettings } from "@/lib/chatbot";

export const maxDuration = 30;

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("chatbot.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("kb_entries")
    .select("id, title, content")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "エントリが見つかりません" }, { status: 404 });

  const d = parsed.data;
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["title", "content", "category", "is_active"] as const) {
    if (d[k] !== undefined) payload[k] = d[k];
  }

  // 本文・タイトルが変わったら埋め込みを再生成（リアルタイム更新）。
  if (d.title !== undefined || d.content !== undefined) {
    const settings = await getChatSettings(admin);
    const newTitle = d.title ?? (existing as any).title;
    const newContent = d.content ?? (existing as any).content;
    payload.embedding = await generateKbEmbedding(settings, newTitle, newContent);
  }

  const { error } = await admin.from("kb_entries").update(payload).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "kb.update",
    targetTable: "kb_entries",
    targetId: params.id,
    meta: { fields: Object.keys(payload) },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("chatbot.manage");
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("kb_entries")
    .select("id, title")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "エントリが見つかりません" }, { status: 404 });

  const { error } = await admin.from("kb_entries").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "kb.delete",
    targetTable: "kb_entries",
    targetId: params.id,
    meta: existing,
  });

  return NextResponse.json({ ok: true });
}
