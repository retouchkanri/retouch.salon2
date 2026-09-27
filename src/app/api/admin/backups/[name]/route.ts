import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { createBackupDownloadUrl, deleteBackup } from "@/lib/dbBackup";
import { parseBackupFileName } from "@/lib/dbBackupSchedule";

export const dynamic = "force-dynamic";

/**
 * ダウンロード。ファイル本体は Vercel を経由させず（レスポンスサイズ上限があるため）、
 * 60 秒だけ有効な Supabase Storage の署名付きURLへリダイレクトする。
 */
export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const session = await requireCapability("backups.manage");
  const name = decodeURIComponent(params.name);
  if (!parseBackupFileName(name)) {
    return NextResponse.json({ error: "不正なファイル名です" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  let url: string;
  try {
    url = await createBackupDownloadUrl(admin, name);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "ダウンロードできませんでした" }, { status: 500 });
  }

  // 会員の個人情報を含むファイルの持ち出しなので、誰がいつ取得したかを残す。
  await writeAudit({
    actorId: session.userId,
    action: "backup.download",
    targetTable: "storage:db-backups",
    meta: { file: name },
  });

  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
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
    targetTable: "storage:db-backups",
    meta: { file: name },
  });

  return NextResponse.json({ ok: true });
}
