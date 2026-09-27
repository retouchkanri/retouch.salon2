import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runBackup } from "@/lib/dbBackup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 全テーブルの読み出し＋圧縮＋保存に数十秒かかる（2026-09 実測: 約 5.4 万行・圧縮後 約 9MB で 20 秒前後）。
export const maxDuration = 60;

/** 手動バックアップ（管理画面「今すぐバックアップ」）。 */
export async function POST() {
  const session = await requireCapability("backups.manage");
  const admin = createSupabaseAdminClient();

  const result = await runBackup(admin, {
    trigger: "manual",
    actorId: session.userId,
    actorEmail: session.email,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
