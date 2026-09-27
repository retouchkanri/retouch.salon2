import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  claimScheduledRun,
  loadBackupConfig,
  runBackup,
  saveScheduledState,
} from "@/lib/dbBackup";
import { type ScheduledState, decideScheduledRun } from "@/lib/dbBackupSchedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 自動 DB バックアップ。vercel.json で「毎日 0〜23 時」の 24 本の cron がこのパスを叩く
 * （Hobby プランは 1 日 1 回の cron しか登録できないため）。実行するかどうかは
 * 管理画面の設定（有効／実行時刻）と進行状況から decideScheduledRun が判定し、
 * 該当しない呼び出しは設定を 1 回読むだけで即座に終わる。
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    // CRON_SECRET を設定している場合、Vercel Cron は Authorization: Bearer <CRON_SECRET> を付ける。
    if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
    return new URL(req.url).searchParams.get("secret") === secret;
  }
  // 未設定の環境では Vercel Cron が付けるヘッダで判定する（/api/cron/newsletters と同じ扱い）。
  // 仮に外部から叩かれても、設定時刻の枠内で 1 日 1 回（失敗時の再試行を含め最大 3 回）
  // バックアップが走るだけで、それ以上の影響はない。
  return Boolean(
    req.headers.get("x-vercel-cron") ||
      req.headers.get("x-vercel-cron-schedule") ||
      req.headers.get("user-agent")?.startsWith("vercel-cron/"),
  );
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  let config: Awaited<ReturnType<typeof loadBackupConfig>>;
  try {
    config = await loadBackupConfig(admin);
  } catch (e: any) {
    console.error("[cron/db-backup] failed to load settings:", e?.message ?? e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }

  const now = new Date();
  const decision = decideScheduledRun(now, config.settings, config.scheduledState);
  if (!decision.run) {
    return NextResponse.json({ ok: true, skipped: decision.reason });
  }

  // Vercel Cron は同じ予定を重複して呼ぶことがあるため、実行権を compare-and-set で取る。
  const running: ScheduledState = {
    occurrence: decision.occurrence,
    status: "running",
    attempts: decision.attempt,
    started_at: now.toISOString(),
  };
  let claimed: boolean;
  try {
    claimed = await claimScheduledRun(admin, config.scheduledStateVersion, running);
  } catch (e: any) {
    console.error("[cron/db-backup] failed to claim run:", e?.message ?? e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
  if (!claimed) {
    return NextResponse.json({ ok: true, skipped: "in_progress" });
  }

  const result = await runBackup(admin, {
    trigger: "scheduled",
    retention: config.settings.retention,
  });

  const finished: ScheduledState = {
    ...running,
    status: result.ok ? "ok" : "error",
    finished_at: new Date().toISOString(),
    error: result.ok ? null : result.error,
    file: result.ok ? result.file : null,
  };
  try {
    await saveScheduledState(admin, finished);
  } catch (e: any) {
    console.error("[cron/db-backup] failed to save state:", e?.message ?? e);
  }

  if (!result.ok) {
    // 失敗を 500 で返して Vercel のログ・監視に乗せる（次の時間帯の cron で再試行される）。
    console.error("[cron/db-backup] backup failed:", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    file: result.file,
    bytes: result.bytes,
    rows: result.rowCount,
    pruned: result.pruned,
    duration_ms: result.durationMs,
  });
}
