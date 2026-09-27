import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  await requireCapability("horses.manage");
  const body = await req.json().catch(() => ({}));
  if (!body?.name) return NextResponse.json({ error: "馬名は必須です" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { error, data } = await admin
    .from("horses")
    .insert({
      name: body.name,
      name_kana: body.name_kana || null,
      sex: body.sex || null,
      birth_year: body.birth_year ?? null,
      profile: body.profile || null,
      image_url: body.image_url || null,
      is_supportable: body.is_supportable ?? true,
      is_emergency_recruitment: body.is_emergency_recruitment ?? false,
      sort_order: body.sort_order ?? 100,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
