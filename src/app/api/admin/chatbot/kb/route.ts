import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { generateKbEmbedding, getChatSettings } from "@/lib/chatbot";

export const maxDuration = 30;

const schema = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください").max(200),
  content: z.string().trim().min(1, "内容を入力してください").max(8000),
  category: z.string().trim().min(1).max(40).default("一般"),
  is_active: z.boolean().default(true),
});

export async function POST(req: Request) {
  const session = await requireCapability("chatbot.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const d = parsed.data;
  const admin = createSupabaseAdminClient();

  // リアルタイムで埋め込みを生成（APIキー未設定なら null＝キーワード検索対象）。
  const settings = await getChatSettings(admin);
  const embedding = await generateKbEmbedding(settings, d.title, d.content);

  const { data, error } = await admin
    .from("kb_entries")
    .insert({
      title: d.title,
      content: d.content,
      category: d.category,
      is_active: d.is_active,
      embedding,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "kb.create",
    targetTable: "kb_entries",
    targetId: data.id,
    meta: { title: d.title, category: d.category, embedded: Boolean(embedding) },
  });

  return NextResponse.json({ ok: true, id: data.id, embedded: Boolean(embedding) });
}
