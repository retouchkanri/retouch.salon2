import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(100_000).optional().nullable(),
  tag: z.string().min(1).max(30).optional(),
  tag_color: z.string().max(100).optional(),
  image_url: z.string().max(500).optional().nullable(),
  pdf_url: z.string().max(1000).optional().nullable(),
  pdf_urls: z.array(z.string().max(1000)).max(80).optional(),
  pdf_names: z.array(z.string().max(200)).max(80).optional(),
  image_urls: z.array(z.string().max(500)).max(20).optional(),
  published_at: z.string().optional(),
  is_published: z.boolean().optional(),
  public_access: z.enum(["public", "members_only"]).optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdmin();
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("news")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "ニュースが見つかりません" }, { status: 404 });
  }

  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const key of ["title", "body", "tag", "tag_color", "image_url", "pdf_url", "is_published", "public_access", "sort_order"] as const) {
    if (parsed.data[key] !== undefined) payload[key] = parsed.data[key] ?? null;
  }
  if (parsed.data.pdf_urls !== undefined) payload.pdf_urls = parsed.data.pdf_urls;
  if (parsed.data.pdf_names !== undefined) payload.pdf_names = parsed.data.pdf_names;
  if (parsed.data.image_urls !== undefined) payload.image_urls = parsed.data.image_urls;
  if (parsed.data.published_at) {
    const d = new Date(parsed.data.published_at);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "日付の形式が不正です" }, { status: 400 });
    }
    payload.published_at = d.toISOString();
  }

  const { error } = await admin.from("news").update(payload).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "news.update",
    targetTable: "news",
    targetId: params.id,
    meta: { prev: existing, next: payload },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdmin();
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("news")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "ニュースが見つかりません" }, { status: 404 });
  }

  const { error } = await admin.from("news").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "news.delete",
    targetTable: "news",
    targetId: params.id,
    meta: existing,
  });

  return NextResponse.json({ ok: true });
}
