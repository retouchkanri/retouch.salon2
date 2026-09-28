import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { extensionForType, savePublicUpload } from "@/lib/fileStorage";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// 管理者が馬画像をアップロードするためのエンドポイント。
// VPS の公開ファイル領域（storage/public/horses/）へ保存し、パス（/uploads/...）を返す。
export async function POST(req: Request) {
  // 認可は try の外で（redirect の制御フロー例外を握りつぶさないため）。
  await requireCapability("horses.manage");

  try {
    const fd = await req.formData().catch(() => null);
    if (!fd) return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });

    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "ファイルが選択されていません" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "画像は5MB以内にしてください" }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "JPEG/PNG/WEBP/GIF のみ対応しています" }, { status: 400 });
    }

    const ext = extensionForType(file.type) ?? "jpg";
    const rand = Math.random().toString(36).slice(2, 8);
    const path = `horses/${Date.now()}-${rand}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // ファイル本体は VPS に保存し、DB にはパス（/uploads/...）だけを保存する。
    const url = await savePublicUpload(path, buffer);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "不明なエラー";
    return NextResponse.json({ error: `アップロード処理でエラー: ${message}` }, { status: 500 });
  }
}
