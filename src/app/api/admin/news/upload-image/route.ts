import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function POST(req: Request) {
  await requireAdmin();

  try {
    const fd = await req.formData().catch(() => null);
    if (!fd) return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });

    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "ファイルが選択されていません" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "画像は10MB以内にしてください" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "JPG/PNG/GIF/WebP画像のみ対応しています" }, { status: 400 });
    }

    const rand = Math.random().toString(36).slice(2, 8);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const path = `news-images/${Date.now()}-${rand}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const admin = createSupabaseAdminClient();
    const { error: upErr } = await admin.storage
      .from("avatars")
      .upload(path, buffer, { contentType: file.type, upsert: true });

    if (upErr) {
      return NextResponse.json(
        { error: `アップロードに失敗しました: ${upErr.message}` },
        { status: 500 },
      );
    }

    const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
    if (!pub?.publicUrl) {
      return NextResponse.json({ error: "公開URLの取得に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url: pub.publicUrl, name: file.name });
  } catch (e) {
    const message = e instanceof Error ? e.message : "不明なエラー";
    return NextResponse.json({ error: `アップロード処理でエラー: ${message}` }, { status: 500 });
  }
}
