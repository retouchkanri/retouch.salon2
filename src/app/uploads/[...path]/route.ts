import { NextResponse } from "next/server";
import { fileResponse } from "@/lib/fileStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 公開アップロードファイル（アバター・馬画像・お知らせ／会員向けメッセージの画像・PDF）の配信。
 * 実体は VPS の <FILE_STORAGE_DIR>/public/ 配下（src/lib/fileStorage.ts）。
 * 保存ファイル名は毎回ユニーク（タイムスタンプ＋乱数）なので長期キャッシュしてよい。
 */
export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const rel = (params.path ?? []).join("/");
  const res = await fileResponse("public", rel, {
    cacheControl: "public, max-age=31536000, immutable",
  });
  return res ?? NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
}
