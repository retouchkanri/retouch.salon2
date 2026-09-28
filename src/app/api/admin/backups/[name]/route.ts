import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { backupFilePath, deleteBackup } from "@/lib/dbBackup";
import { parseBackupFileName } from "@/lib/dbBackupSchedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ダウンロード。VPS のローカル backups/ に保存したファイルをそのまま返す。 */
export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const session = await requireCapability("backups.manage");
  const name = decodeURIComponent(params.name);
  if (!parseBackupFileName(name)) {
    return NextResponse.json({ error: "不正なファイル名です" }, { status: 400 });
  }

  const file = backupFilePath(name);
  let size: number;
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    size = s.size;
  } catch {
    return NextResponse.json({ error: "バックアップファイルが見つかりません" }, { status: 404 });
  }

  // 会員の個人情報を含むファイルの持ち出しなので、誰がいつ取得したかを残す。
  await writeAudit({
    actorId: session.userId,
    action: "backup.download",
    targetTable: "vps:backups",
    meta: { file: name },
  });

  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: { name: string } }) {
  const session = await requireCapability("backups.manage");
  const name = decodeURIComponent(params.name);
  if (!parseBackupFileName(name)) {
    return NextResponse.json({ error: "不正なファイル名です" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  try {
    await deleteBackup(admin, name);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "削除できませんでした" }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "backup.delete",
    targetTable: "vps:backups",
    meta: { file: name },
  });

  return NextResponse.json({ ok: true });
}
