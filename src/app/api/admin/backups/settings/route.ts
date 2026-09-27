import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { saveBackupSettings } from "@/lib/dbBackup";
import { RETENTION_MAX, RETENTION_MIN } from "@/lib/dbBackupSchedule";

const schema = z.object({
  enabled: z.boolean(),
  hour_jst: z.number().int().min(0).max(23),
  retention: z.number().int().min(RETENTION_MIN).max(RETENTION_MAX),
});

/** 自動バックアップ設定（有効／実行時刻／保存世代数）の保存。 */
export async function POST(req: Request) {
  const session = await requireCapability("backups.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }

  const settings = {
    enabled: parsed.data.enabled,
    hourJst: parsed.data.hour_jst,
    retention: parsed.data.retention,
  };
  const admin = createSupabaseAdminClient();
  try {
    await saveBackupSettings(admin, settings, session.userId);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "保存できませんでした" }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "backup.settings_update",
    targetTable: "app_settings",
    meta: settings,
  });

  return NextResponse.json({ ok: true });
}
