import { NextResponse } from "next/server";
import { communityFileAllowed, communityUser, pullLegacyCommunityFile } from "@/lib/community/files";
import { fileResponse, normalizeRelPath } from "@/lib/fileStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 添付ファイルの閲覧（そのチャンネルを読める人のみ）。 */
export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const rel = normalizeRelPath((params.path ?? []).join("/"));
  if (!rel) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });

  const auth = await communityUser();
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  if (!(await communityFileAllowed(auth.db, "community_storage_can_read", rel))) {
    return NextResponse.json({ error: "このファイルを表示する権限がありません。" }, { status: 403 });
  }

  const opts = { cacheControl: "private, max-age=3600" };
  let res = await fileResponse("community", rel, opts);
  if (!res && (await pullLegacyCommunityFile(rel))) {
    res = await fileResponse("community", rel, opts);
  }
  return res ?? NextResponse.json({ error: "ファイルが見つかりません。" }, { status: 404 });
}
