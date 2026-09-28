/**
 * フルバックアップ（DB + VPS のアップロードファイル）を今すぐ 1 つ作成する。
 * 管理画面の「今すぐバックアップ」と同じ処理（backups/ に .tar.gz を保存し、最終実行と監査ログを記録）。
 *
 *   npx tsx scripts/backup-now.ts                … 手動バックアップとして作成（自動削除されない）
 *   npx tsx scripts/backup-now.ts --scheduled    … 自動バックアップとして作成（設定の保存世代数を超えた古いものは削除）
 *
 * VPS では Vercel Cron が動かないため、定期実行する場合は Windows のタスク スケジューラ等から
 * このスクリプトを呼び出す（作業フォルダはプロジェクト直下にすること）。
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { createSupabaseAdminClient } = await import("../src/lib/supabase/admin");
  const { loadBackupConfig, runBackup } = await import("../src/lib/dbBackup");
  const admin = createSupabaseAdminClient();
  const scheduled = process.argv.includes("--scheduled");
  const retention = scheduled ? (await loadBackupConfig(admin)).settings.retention : undefined;

  const result = await runBackup(admin, { trigger: scheduled ? "scheduled" : "manual", retention });
  if (!result.ok) {
    console.error(`バックアップに失敗しました: ${result.error}`);
    process.exit(1);
  }
  console.log(`backups/${result.file}`);
  console.log(
    `  ${(result.bytes / 1024 / 1024).toFixed(1)} MB・${result.tableCount} テーブル・${result.rowCount} 行・` +
      `認証ユーザー ${result.authUserCount} 件・ファイル ${result.fileCount} 件・${(result.durationMs / 1000).toFixed(1)} 秒`,
  );
  for (const w of result.warnings) console.log(`  ⚠ ${w}`);
  if (result.pruned.length > 0) console.log(`  古い自動バックアップを削除: ${result.pruned.join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
