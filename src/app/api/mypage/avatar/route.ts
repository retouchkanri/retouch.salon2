import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }

  const fd = await req.formData().catch(() => null);
  if (!fd) {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }

  const file = fd.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "ファイルが選択されていません" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "画像は5MB以内にしてください" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "JPEG/PNG/WEBP/GIF のみ対応しています" }, { status: 400 });
  }

  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
    : file.type.split("/")[1] ?? "jpg";
  const path = `${session.userId}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const admin = createSupabaseAdminClient();
  const { error: upErr } = await admin.storage
    .from("avatars")
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) {
    return NextResponse.json({ error: "アップロードに失敗しました" }, { status: 500 });
  }

  const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = pub.publicUrl;

  const { error } = await admin
    .from("customers")
    .update({ avatar_url: avatarUrl })
    .eq("id", session.customerId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, avatar_url: avatarUrl });
}
