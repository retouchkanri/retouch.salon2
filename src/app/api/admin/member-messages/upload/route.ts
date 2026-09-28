import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { savePublicUpload, withTypeExtension } from "@/lib/fileStorage";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

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
      return NextResponse.json({ error: "PDFは20MB以内にしてください" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDFファイル（.pdf）のみ対応しています" }, { status: 400 });
    }

    const rand = Math.random().toString(36).slice(2, 8);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const path = `member-message-pdfs/${Date.now()}-${rand}-${withTypeExtension(safeName, file.type)}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // ファイル本体は VPS に保存し、DB にはパス（/uploads/...）だけを保存する。
    const url = await savePublicUpload(path, buffer);
    return NextResponse.json({ ok: true, url, name: file.name });
  } catch (e) {
    const message = e instanceof Error ? e.message : "不明なエラー";
    return NextResponse.json({ error: `アップロード処理でエラー: ${message}` }, { status: 500 });
  }
}
