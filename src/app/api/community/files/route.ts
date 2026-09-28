import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ATTACHMENT_ALLOWED_TYPES, ATTACHMENT_MAX_BYTES } from "@/lib/community/constants";
import { communityFileAllowed, communityUser, removeCommunityFiles } from "@/lib/community/files";
import { extensionForType, normalizeRelPath, saveFile } from "@/lib/fileStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 添付ファイルのアップロード（VPS に保存し、DB に保存するパスと表示用の情報を返す）。 */
export async function POST(req: Request) {
  const auth = await communityUser();
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const channelId = String(fd?.get("channelId") ?? "");
  if (!(file instanceof File) || file.size === 0 || !UUID_RE.test(channelId)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return NextResponse.json({ error: `「${file.name}」は10MBを超えているため添付できません。` }, { status: 400 });
  }
  const ext = extensionForType(file.type);
  if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type) || !ext) {
    return NextResponse.json(
      { error: `「${file.name}」は添付できない形式です（画像・PDF・Office文書・テキストのみ）。` },
      { status: 400 },
    );
  }

  // 拡張子はファイル名ではなく検証済みの MIME タイプから決める（配信時の Content-Type もこれで決まる）。
  const path = `${channelId.toLowerCase()}/${auth.userId}/${randomUUID()}.${ext}`;
  if (!(await communityFileAllowed(auth.db, "community_storage_can_upload", path))) {
    return NextResponse.json({ error: "このチャンネルにはファイルを投稿できません。" }, { status: 403 });
  }

  try {
    await saveFile("community", path, Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: `「${file.name}」をアップロードできませんでした。` }, { status: 500 });
  }
  return NextResponse.json({ path, name: file.name.slice(0, 200), type: file.type, size: file.size });
}

/** 添付ファイルの削除（自分のファイル、または運営）。 */
export async function DELETE(req: Request) {
  const auth = await communityUser();
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.paths) ? body.paths.slice(0, 50) : [];
  const paths = raw
    .map((p) => (typeof p === "string" ? normalizeRelPath(p) : null))
    .filter((p): p is string => !!p);

  const allowed: string[] = [];
  for (const p of paths) {
    if (await communityFileAllowed(auth.db, "community_storage_can_delete", p)) allowed.push(p);
  }
  await removeCommunityFiles(allowed);
  return NextResponse.json({ ok: true, removed: allowed.length });
}
