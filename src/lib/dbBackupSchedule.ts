/**
 * DB バックアップの設定・スケジュール判定・ファイル名の純粋ロジック（I/O なし）。
 * 実際のエクスポート／保存は dbBackup.ts が担う。ここはテスト容易性のため分離している。
 *
 * スケジュール方式:
 *   Vercel Hobby プランの cron は「1 日 1 回・指定時間帯の ±59 分」しか使えない
 *   （毎時 cron はデプロイ自体が失敗する。2026-06-19 の 6e83ffd 参照）。
 *   そこで vercel.json に「毎日 H 時（H=0〜23）」の cron を 24 本登録し、
 *   各呼び出しで「今が設定時刻の実行枠内か」をここで判定する。
 *   実行枠は設定時刻から RETRY_WINDOW_MS（3 時間）で、失敗・取りこぼし時は
 *   後続の枠（H+1, H+2 時）で最大 MAX_SCHEDULED_ATTEMPTS 回まで再試行する。
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 日本時間（UTC+9、夏時間なし）。 */
const JST_OFFSET_MS = 9 * HOUR_MS;

/** 設定時刻からこの時間内なら自動バックアップを実行（再試行）してよい。 */
export const RETRY_WINDOW_MS = 3 * HOUR_MS;
/** 1 回の予定実行あたりの最大試行回数（失敗時の再試行を含む）。 */
export const MAX_SCHEDULED_ATTEMPTS = 3;
/** 「実行中」のまま応答がない場合に、関数のタイムアウト等で中断されたとみなすまでの時間。 */
export const RUNNING_STALE_MS = 10 * 60 * 1000;

export const RETENTION_MIN = 1;
export const RETENTION_MAX = 90;

export type BackupSettings = {
  enabled: boolean;
  /** 実行時刻（日本時間の「時」、0〜23）。 */
  hourJst: number;
  /** 自動バックアップの保存世代数。これを超えた古い自動バックアップは削除する。 */
  retention: number;
};

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: false,
  hourJst: 3,
  retention: 14,
};

export type BackupTrigger = "manual" | "scheduled";

/** 自動バックアップの進行状況（app_settings に JSON で保存）。 */
export type ScheduledState = {
  /** 対象の予定時刻（ISO）。同じ予定を二重に実行しないための識別子。 */
  occurrence: string;
  status: "running" | "ok" | "error";
  attempts: number;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
  file?: string | null;
};

export type ScheduleDecision =
  | { run: true; occurrence: string; attempt: number }
  | {
      run: false;
      reason: "disabled" | "outside_window" | "already_done" | "in_progress" | "max_attempts";
    };

function toInt(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

/** app_settings の生の値からバックアップ設定を組み立てる（不正値は既定値に戻す）。 */
export function parseBackupSettings(raw: {
  enabled?: string | null;
  hour?: string | null;
  retention?: string | null;
}): BackupSettings {
  const hour = toInt(raw.hour);
  const retention = toInt(raw.retention);
  return {
    enabled: raw.enabled === "true",
    hourJst: hour != null && hour >= 0 && hour <= 23 ? hour : DEFAULT_BACKUP_SETTINGS.hourJst,
    retention:
      retention != null && retention >= RETENTION_MIN && retention <= RETENTION_MAX
        ? retention
        : DEFAULT_BACKUP_SETTINGS.retention,
  };
}

export function parseScheduledState(raw: string | null | undefined): ScheduledState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.occurrence !== "string" || typeof v.status !== "string") return null;
    return { ...v, attempts: Number.isInteger(v.attempts) ? v.attempts : 1 };
  } catch {
    return null;
  }
}

/** `now` 以前で直近の「日本時間 hourJst:00」。 */
export function latestOccurrence(now: Date, hourJst: number): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  let occ =
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hourJst) - JST_OFFSET_MS;
  if (occ > now.getTime()) occ -= DAY_MS;
  return new Date(occ);
}

/** `now` より後で次の「日本時間 hourJst:00」。 */
export function nextOccurrence(now: Date, hourJst: number): Date {
  return new Date(latestOccurrence(now, hourJst).getTime() + DAY_MS);
}

/** cron から呼ばれた時点で、自動バックアップを実行すべきかを判定する。 */
export function decideScheduledRun(
  now: Date,
  settings: BackupSettings,
  state: ScheduledState | null,
): ScheduleDecision {
  if (!settings.enabled) return { run: false, reason: "disabled" };

  const occ = latestOccurrence(now, settings.hourJst);
  if (now.getTime() - occ.getTime() >= RETRY_WINDOW_MS) {
    return { run: false, reason: "outside_window" };
  }

  const occurrence = occ.toISOString();
  if (state && state.occurrence === occurrence) {
    if (state.status === "ok") return { run: false, reason: "already_done" };
    const startedAt = new Date(state.started_at).getTime();
    const stale = Number.isNaN(startedAt) || now.getTime() - startedAt >= RUNNING_STALE_MS;
    if (state.status === "running" && !stale) return { run: false, reason: "in_progress" };
    if (state.attempts >= MAX_SCHEDULED_ATTEMPTS) return { run: false, reason: "max_attempts" };
    return { run: true, occurrence, attempt: state.attempts + 1 };
  }
  return { run: true, occurrence, attempt: 1 };
}

// ---------------------------------------------------------------------------
// バックアップファイル名（VPS のローカル backups/ 配下に置く）
//   自動: db-backup_2026-09-26_scheduled.tar.gz  （日本時間の日付ごと 1 ファイル）
//   手動: db-backup_2026-09-25T18-00-12-345Z_manual.tar.gz
// .tar.gz は DB とアップロードファイル一式をまとめたフルバックアップ。
// .json.gz は旧形式（DB のみ）で、一覧・ダウンロード・世代管理・復元の対象として引き続き扱う。
// 名前だけで作成日時と種別がわかるようにし、一覧・世代管理に使う。
// ---------------------------------------------------------------------------

/** VPS のローカル FS 上のバックアップ格納フォルダ名。 */
export const BACKUP_FOLDER = "backups";

const TIMESTAMP_NAME_RE =
  /^db-backup_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_(manual|scheduled)\.(?:tar|json)\.gz$/;
/** 自動バックアップ用。1 日（日本時間）あたり 1 ファイル。 */
const DAILY_SCHEDULED_NAME_RE = /^db-backup_(\d{4}-\d{2}-\d{2})_scheduled\.(?:tar|json)\.gz$/;

/** `at` の日本時間カレンダー日を YYYY-MM-DD で返す。 */
export function jstCalendarDate(at: Date): string {
  const jst = new Date(at.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * バックアップのファイル名（フォルダなしの basename）。
 * 自動は日付単位で固定し、同日の再試行は同じファイルを上書きする。
 */
export function backupFileName(at: Date, trigger: BackupTrigger): string {
  if (trigger === "scheduled") {
    return `db-backup_${jstCalendarDate(at)}_scheduled.tar.gz`;
  }
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `db-backup_${stamp}_manual.tar.gz`;
}

/** 旧形式（DB のみの gzip JSON）のファイルか。 */
export function isLegacyJsonBackup(name: string): boolean {
  return name.endsWith(".json.gz");
}

/** ローカル上の相対パス（`backups/<basename>`）。 */
export function backupObjectPath(name: string): string {
  return `${BACKUP_FOLDER}/${name}`;
}

/**
 * 正規のバックアップファイル名なら作成日時と種別を返す。
 * パス区切りや `backups/` 以外のプレフィックスを含むものは null（パストラバーサル防止）。
 */
export function parseBackupFileName(
  name: string,
): { createdAt: Date; trigger: BackupTrigger } | null {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;

  const daily = DAILY_SCHEDULED_NAME_RE.exec(name);
  if (daily) {
    // ファイル名の日付は日本時間の暦日。表示・並び替え用にその日 00:00 JST を返す。
    const createdAt = new Date(`${daily[1]}T00:00:00+09:00`);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, trigger: "scheduled" };
  }

  const m = TIMESTAMP_NAME_RE.exec(name);
  if (!m) return null;
  const createdAt = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, trigger: m[6] as BackupTrigger };
}

/**
 * uuid の値域を先頭 1 バイトで parts 等分した [下限, 上限) の一覧（null は無制限）。
 * 端は開いているので、全範囲を漏れ・重複なく覆う。parts は 1〜256。
 */
export function uuidRangeBounds(parts: number): Array<[string | null, string | null]> {
  const n = Math.min(256, Math.max(1, Math.floor(parts)));
  const bounds: Array<string | null> = [null];
  for (let i = 1; i < n; i++) {
    const byte = Math.floor((i * 256) / n);
    bounds.push(`${byte.toString(16).padStart(2, "0")}000000-0000-0000-0000-000000000000`);
  }
  bounds.push(null);
  return bounds.slice(0, -1).map((lower, i) => [lower, bounds[i + 1]]);
}

/**
 * 保存世代数を超えた自動バックアップのファイル名を返す（新しい順に retention 件を残す）。
 * 手動バックアップは運用上の節目に取るものなので、自動では削除しない。
 */
export function selectExpiredBackups(names: string[], retention: number): string[] {
  return names
    .map((name) => ({ name, parsed: parseBackupFileName(name) }))
    .filter((f) => f.parsed?.trigger === "scheduled")
    .sort((a, b) => b.parsed!.createdAt.getTime() - a.parsed!.createdAt.getTime())
    .slice(Math.max(0, retention))
    .map((f) => f.name);
}
