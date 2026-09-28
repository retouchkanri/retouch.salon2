import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { type BackupConfig, listBackups, loadBackupConfig } from "@/lib/dbBackup";
import {
  DEFAULT_BACKUP_SETTINGS,
  RETENTION_MAX,
  RETENTION_MIN,
  RUNNING_STALE_MS,
  nextOccurrence,
} from "@/lib/dbBackupSchedule";
import BackupSettingsForm from "./BackupSettingsForm";
import BackupNowButton from "./BackupNowButton";
import BackupDeleteButton from "./BackupDeleteButton";

export const dynamic = "force-dynamic";

const TRIGGER_LABELS = { manual: "手動", scheduled: "自動" } as const;

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** 自動バックアップの直近の状態を表示用に解釈する。 */
function scheduledStatus(config: BackupConfig, now: Date): { cls: string; text: string } | null {
  const s = config.scheduledState;
  if (!s) return null;
  const when = formatDate(s.occurrence, true);
  if (s.status === "ok") return { cls: "chip-ok", text: `✓ ${when} の自動バックアップ成功` };
  if (s.status === "running") {
    const started = new Date(s.started_at).getTime();
    if (now.getTime() - started < RUNNING_STALE_MS) {
      return { cls: "chip-warn", text: `${when} の自動バックアップを実行中` };
    }
    return { cls: "chip-error", text: `✗ ${when} の自動バックアップが中断されました（タイムアウト等）` };
  }
  return { cls: "chip-error", text: `✗ ${when} の自動バックアップ失敗（${s.attempts} 回試行）` };
}

export default async function BackupsAdminPage() {
  await requireCapability("backups.manage");
  const admin = createSupabaseAdminClient();

  let config: BackupConfig = {
    settings: DEFAULT_BACKUP_SETTINGS,
    lastRun: null,
    scheduledState: null,
    scheduledStateVersion: null,
  };
  let configError: string | null = null;
  try {
    config = await loadBackupConfig(admin);
  } catch (e: any) {
    configError = e?.message ?? "設定を読み込めませんでした";
  }
  const { files, error: listError } = await listBackups(admin);

  const now = new Date();
  const { settings, lastRun, scheduledState } = config;
  const status = scheduledStatus(config, now);
  const totalBytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  // 有効なのに 2 日以上自動実行の記録が更新されていなければ、cron が動いていない可能性が高い。
  const cronLooksDead =
    settings.enabled &&
    scheduledState != null &&
    now.getTime() - new Date(scheduledState.occurrence).getTime() > 2 * 24 * 60 * 60 * 1000;

  return (
    <div className="space-y-8 max-w-4xl">
      <h1 className="text-2xl font-bold">DBバックアップ</h1>

      {configError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {configError}
        </p>
      )}

      {/* ── Status ── */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-lg">状態</h2>
        <div className="flex flex-wrap gap-2">
          <span className={settings.enabled ? "chip-ok" : "chip-mute"}>
            {settings.enabled ? "✓ 自動バックアップ有効" : "自動バックアップ無効"}
          </span>
          {settings.enabled && (
            <span className="chip-mute">毎日 {hourLabel(settings.hourJst)}（日本時間）</span>
          )}
          <span className="chip-mute">自動分の保存: {settings.retention} 世代</span>
          <span className="chip-mute">
            保存済み: {files.length} 件（{formatBytes(totalBytes)}）
          </span>
        </div>

        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          {settings.enabled && (
            <>
              <dt className="text-ink-soft">次回予定</dt>
              <dd>{formatDate(nextOccurrence(now, settings.hourJst), true)} 頃</dd>
            </>
          )}
          <dt className="text-ink-soft">最終実行</dt>
          <dd>
            {lastRun ? (
              <>
                {formatDate(lastRun.at, true)}（{TRIGGER_LABELS[lastRun.trigger] ?? lastRun.trigger}）{" "}
                {lastRun.ok ? (
                  <span className="text-green-700">
                    ✓ 成功 — {formatBytes(lastRun.bytes)}・{(lastRun.rows ?? 0).toLocaleString("ja-JP")} 行・
                    {lastRun.tables} テーブル・認証ユーザー {lastRun.auth_users ?? 0} 件
                    {lastRun.files != null && (
                      <>・ファイル {lastRun.files.toLocaleString("ja-JP")} 件（{formatBytes(lastRun.file_bytes)}）</>
                    )}
                  </span>
                ) : (
                  <span className="text-red-600">✗ 失敗 — {lastRun.error}</span>
                )}
              </>
            ) : (
              "まだ実行されていません"
            )}
          </dd>
        </dl>
        {lastRun?.ok && (lastRun.warnings?.length ?? 0) > 0 && (
          <ul className="text-sm text-amber-800 list-disc pl-5">
            {lastRun.warnings!.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {status && <span className={status.cls}>{status.text}</span>}
        {scheduledState?.status === "error" && scheduledState.error && (
          <p className="text-sm text-red-600">エラー: {scheduledState.error}</p>
        )}
        {cronLooksDead && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            自動バックアップが 2 日以上実行されていません。Vercel の Cron Jobs 設定と環境変数
            <code className="bg-surface-2 px-1 rounded mx-1">CRON_SECRET</code>を確認してください。
          </p>
        )}
      </section>

      {/* ── Schedule settings ── */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">自動バックアップ設定</h2>
        <p className="text-sm text-ink-soft">
          毎日指定した時刻（日本時間）にデータベース全体を自動でバックアップします。
          Vercel の仕様上、実際の実行は指定時刻から最大 59 分ほど遅れることがあります。
          失敗した場合は 1 時間後・2 時間後に自動で再試行します。
        </p>
        <BackupSettingsForm
          initial={settings}
          retentionMin={RETENTION_MIN}
          retentionMax={RETENTION_MAX}
        />
      </section>

      {/* ── Manual backup ── */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">手動バックアップ</h2>
        <p className="text-sm text-ink-soft">
          大きな変更（データ移行・一括修正など）の前に、その時点のバックアップを取っておけます。
          手動バックアップは自動削除されず、削除するまで保存されます。
        </p>
        <BackupNowButton />
      </section>

      {/* ── Backup list ── */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">保存済みバックアップ</h2>
        {listError && (
          <p className="text-sm text-red-600">一覧を取得できませんでした: {listError}</p>
        )}
        {!listError && files.length === 0 ? (
          <p className="text-sm text-ink-mute">まだバックアップはありません。</p>
        ) : (
          files.length > 0 && (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-line text-ink-soft text-left">
                    <th className="px-4 py-2 font-medium">作成日時（日本時間）</th>
                    <th className="px-4 py-2 font-medium">種別</th>
                    <th className="px-4 py-2 font-medium text-right">サイズ</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.name} className="border-b border-surface-line last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(f.createdAt, true)}</td>
                      <td className="px-4 py-2">
                        <span className={f.trigger === "manual" ? "chip-warn" : "chip-mute"}>
                          {TRIGGER_LABELS[f.trigger]}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{formatBytes(f.size)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-right space-x-4">
                        <a
                          className="text-brand underline text-sm"
                          href={`/api/admin/backups/${encodeURIComponent(f.name)}`}
                        >
                          ダウンロード
                        </a>
                        <BackupDeleteButton name={f.name} label={formatDate(f.createdAt, true)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>

      {/* ── Notes ── */}
      <section className="card space-y-2 text-sm text-ink-soft">
        <h2 className="font-semibold text-lg text-ink">バックアップについて</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            内容: データベースの全テーブル（会員・支援・契約・決済・寄付・予約・お知らせ・監査ログ等）と、
            ログイン用の認証ユーザー一覧（メールアドレス等。パスワードは含まれません）に加え、
            VPS に保存しているアップロードファイル一式（会員アバター・馬画像・お知らせ／会員向けメッセージの画像・PDF・
            コミュニティの添付ファイル）。
          </li>
          <li>
            形式: すべてを 1 つにまとめた .tar.gz ファイル（manifest.json・database.json・files/）。
            Windows の <code className="bg-surface-2 px-1 rounded mx-1">tar -xzf</code> や 7-Zip で展開できます。
            以前の .json.gz（DB のみ）も一覧・ダウンロード・復元できます。
          </li>
          <li>
            保存先: この VPS のプロジェクト内
            <code className="bg-surface-2 px-1 rounded mx-1">backups/</code>
            フォルダ（非公開）。自動バックアップは日本時間の日付ごと 1 ファイルです。
            ダウンロード・削除は監査ログに記録されます。サーバー障害に備え、定期的にダウンロードして別の場所にも保管してください。
          </li>
          <li>
            会員の個人情報を含みます。ダウンロードしたファイルは社外に送らず、不要になったら削除してください。
          </li>
          <li>
            自動バックアップは保存世代数を超えた古いものから自動で削除されます。
          </li>
          <li>
            復元は画面からは行えません。開発担当者がサーバー上で
            <code className="bg-surface-2 px-1 rounded mx-1">npx tsx scripts/restore-backup.ts backups/&lt;ファイル名&gt;</code>
            を実行して、データベースとファイルを戻します（手順は README の「バックアップと復元」）。
          </li>
        </ul>
      </section>
    </div>
  );
}
