import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(100_000).optional().nullable(),
  tag: z.string().min(1).max(30).default("お知らせ"),
  tag_color: z.string().max(100).default("bg-brand-50 text-brand-dark"),
  image_url: z.string().max(500).optional().nullable(),
  pdf_url: z.string().max(1000).optional().nullable(),
  pdf_urls: z.array(z.string().max(1000)).max(80).optional().default([]),
  pdf_names: z.array(z.string().max(200)).max(80).optional().default([]),
  image_urls: z.array(z.string().max(500)).max(20).optional().default([]),
  published_at: z.string().optional(),
  is_published: z.boolean().optional().default(true),
  public_access: z.enum(["public", "members_only"]).optional().default("public"),
  sort_order: z.coerce.number().int().min(0).default(0),
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
  const payload = {
    title: parsed.data.title,
    body: parsed.data.body || null,
    tag: parsed.data.tag,
    tag_color: parsed.data.tag_color,
    image_url: parsed.data.image_url || null,
    pdf_url: parsed.data.pdf_url || null,
    pdf_urls: parsed.data.pdf_urls ?? [],
    pdf_names: parsed.data.pdf_names ?? [],
    image_urls: parsed.data.image_urls ?? [],
    published_at: parsed.data.published_at
      ? new Date(parsed.data.published_at).toISOString()
      : new Date().toISOString(),
    is_published: parsed.data.is_published,
    public_access: parsed.data.public_access,
    sort_order: parsed.data.sort_order,
  };

  const { error, data } = await admin
    .from("news")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "news.create",
    targetTable: "news",
    targetId: data.id,
    meta: payload,
  });

  return NextResponse.json({ ok: true, id: data.id });
}
