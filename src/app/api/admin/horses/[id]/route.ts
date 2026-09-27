import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await requireCapability("horses.manage");
  const body = await req.json().catch(() => ({}));
  const admin = createSupabaseAdminClient();
  const payload: any = {};
  for (const key of ["name","name_kana","sex","birth_year","profile","is_supportable","is_emergency_recruitment","sort_order","image_url"]) {
    if (key in body) payload[key] = body[key];
  }
  const { error } = await admin.from("horses").update(payload).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await requireCapability("horses.manage");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("horses").delete().eq("id", params.id);
  if (error) {
    // 支援・契約などが紐づいている馬は外部キー制約で削除できない。
    // 利用者に理由が伝わるメッセージを返す（500 ではなく 409）。
    return NextResponse.json(
      { error: "この馬には支援などのデータが紐づいているため削除できません。先に関連データを停止・整理してください。" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
