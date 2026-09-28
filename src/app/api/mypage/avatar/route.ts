import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extensionForType, savePublicUpload } from "@/lib/fileStorage";

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

  // 拡張子は検証済みの MIME タイプから決める（配信時の Content-Type が拡張子で決まるため）。
  const ext = extensionForType(file.type) ?? "jpg";
  const path = `${session.userId}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // ファイル本体は VPS に保存し、DB にはパス（/uploads/...）だけを保存する。
  let avatarUrl: string;
  try {
    avatarUrl = await savePublicUpload(path, buffer);
  } catch {
    return NextResponse.json({ error: "アップロードに失敗しました" }, { status: 500 });
  }

  const admin = createSupabaseAdminClient();

  const { error } = await admin
    .from("customers")
    .update({ avatar_url: avatarUrl })
    .eq("id", session.customerId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // コミュニティのアイコンも同じ写真にそろえる（プロフィール行がまだ無い場合は、
  // 初めてコミュニティを開いたときに customers.avatar_url から作られる）。
  await admin.from("community_profiles").update({ avatar_url: avatarUrl }).eq("user_id", session.userId);

  return NextResponse.json({ ok: true, avatar_url: avatarUrl });
}
