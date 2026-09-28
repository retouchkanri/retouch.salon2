/**
 * システム全体のバックアップ（管理画面「DBバックアップ」と自動バックアップ cron から利用）。
 *
 * サービスロールで public スキーマの全テーブルを PostgREST 経由で全件読み出し、
 * 認証ユーザー一覧と合わせた JSON（database.json）と、VPS に保存しているアップロードファイル一式
 * （アバター・馬画像・お知らせ／会員向けメッセージの画像・PDF・コミュニティの添付ファイル）を
 * 1 つの .tar.gz にまとめ、VPS のローカル `backups/` フォルダに保存する。
 * 自動バックアップは日本時間の日付ごと 1 ファイル（同日の再試行は上書き）。
 * 復元は scripts/restore-backup.ts（DB とファイルの両方を戻せる）。
 *
 * - 読み取りのみ（既存テーブルへの書き込みは app_settings の db_backup.* キーだけ）。
 * - 会員の個人情報を含むため、backups/ は公開ディレクトリの外。ダウンロードは管理者のみ（監査ログに記録）。
 * - テーブル間で完全に同一時点のスナップショットではない（数十秒の取得中の更新は混在しうる）。
 */
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PG_MAX_ROWS, fetchAllRows } from "./fetchAll";
import { writeAudit } from "./audit";
import { STORAGE_AREAS, listFiles } from "./fileStorage";
import { TarWriter } from "./tarball";
import {
  type BackupSettings,
  type BackupTrigger,
  type ScheduledState,
  BACKUP_FOLDER,
  backupFileName,
  parseBackupFileName,
  parseBackupSettings,
  parseScheduledState,
  selectExpiredBackups,
  uuidRangeBounds,
} from "./dbBackupSchedule";

type Admin = SupabaseClient<any, any, any>;

/** 監査ログの target_table に記録する保存先の名前。 */
const BACKUP_TARGET = "vps:" + BACKUP_FOLDER;

export const BACKUP_SETTING_KEYS = {
  enabled: "db_backup.enabled",
  hour: "db_backup.hour_jst",
  retention: "db_backup.retention",
  lastRun: "db_backup.last_run",
  scheduledState: "db_backup.scheduled_state",
} as const;

/**
 * テーブル一覧の自動取得に失敗したときの予備（2026-09 時点の public スキーマ）と主キー。
 * 通常は PostgREST の OpenAPI 定義から自動取得するため、テーブル追加時の更新は必須ではない。
 */
const KNOWN_TABLES: Record<string, string[]> = {
  admin_memos: ["id"],
  app_settings: ["key"],
  audit_logs: ["id"],
  bookings: ["id"],
  contracts: ["id"],
  customers: ["id"],
  donations: ["id"],
  events: ["id"],
  horse_meeting_requests: ["id"],
  horses: ["id"],
  kb_entries: ["id"],
  member_message_recipients: ["id"],
  member_messages: ["id"],
  membership_plans: ["id"],
  news: ["id"],
  payments: ["id"],
  profiles: ["id"],
  registration_tokens: ["id"],
  special_team_memberships: ["id"],
  support_subscriptions: ["id"],
};

/** ビューは他テーブルから導出できるため保存しない（命名規約 v_ も除外）。 */
const EXCLUDED_RELATIONS = new Set(["v_customer_summary"]);

/** 同時に発行する読み出しリクエスト数の上限（稼働中の本番 DB への負荷を抑える）。 */
const READ_CONCURRENCY = 6;
/** この行数を超える uuid 主キーのテーブルは、キー範囲で分割して並行に読み出す。 */
const PARTITION_MIN_ROWS = 3000;
const UUID_PARTITIONS = 4;
const AUTH_USERS_PER_PAGE = 1000;
/** テーブル読み出しに使える時間。残りを圧縮・アップロード・記録に充てる（maxDuration=60 秒）。 */
const READ_BUDGET_MS = 40_000;

type TableSpec = {
  name: string;
  primaryKey: string[];
  /** 主キーが uuid 1 列（キー範囲で分割できる）か。 */
  uuidKey: boolean;
};

export type LastRun = {
  at: string;
  trigger: BackupTrigger;
  ok: boolean;
  file?: string | null;
  bytes?: number;
  rows?: number;
  tables?: number;
  auth_users?: number;
  files?: number;
  file_bytes?: number;
  duration_ms?: number;
  error?: string | null;
  warnings?: string[];
};

export type BackupConfig = {
  settings: BackupSettings;
  lastRun: LastRun | null;
  scheduledState: ScheduledState | null;
  /**
   * 進行状況の行の updated_at（行が無ければ null）。二重実行防止の compare-and-set で
   * 「読んだ時点から誰も書き換えていないこと」の確認に使う。
   */
  scheduledStateVersion: string | null;
};

export type BackupFile = {
  name: string;
  createdAt: string;
  trigger: BackupTrigger;
  size: number | null;
};

export type BackupRunResult =
  | {
      ok: true;
      file: string;
      bytes: number;
      rawBytes: number;
      tableCount: number;
      rowCount: number;
      authUserCount: number;
      fileCount: number;
      fileBytes: number;
      durationMs: number;
      warnings: string[];
      pruned: string[];
    }
  | { ok: false; error: string; durationMs: number };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// 設定（app_settings の db_backup.* キー）
// ---------------------------------------------------------------------------

export async function loadBackupConfig(admin: Admin): Promise<BackupConfig> {
  const { data, error } = await admin
    .from("app_settings")
    .select("key, value, updated_at")
    .in("key", Object.values(BACKUP_SETTING_KEYS));
  if (error) throw new Error(`バックアップ設定の読み込みに失敗しました: ${error.message}`);

  const map = new Map<string, string | null>(
    (data ?? []).map((r: any) => [r.key as string, (r.value as string | null) ?? null]),
  );
  let lastRun: LastRun | null = null;
  try {
    const raw = map.get(BACKUP_SETTING_KEYS.lastRun);
    lastRun = raw ? (JSON.parse(raw) as LastRun) : null;
  } catch {
    lastRun = null;
  }
  const stateRow = (data ?? []).find((r: any) => r.key === BACKUP_SETTING_KEYS.scheduledState) as
    | { value: string | null; updated_at: string }
    | undefined;
  return {
    settings: parseBackupSettings({
      enabled: map.get(BACKUP_SETTING_KEYS.enabled),
      hour: map.get(BACKUP_SETTING_KEYS.hour),
      retention: map.get(BACKUP_SETTING_KEYS.retention),
    }),
    lastRun,
    scheduledState: parseScheduledState(stateRow?.value),
    scheduledStateVersion: stateRow?.updated_at ?? null,
  };
}

async function upsertSetting(
  admin: Admin,
  key: string,
  value: string | null,
  actorId: string | null,
): Promise<void> {
  const { error } = await admin
    .from("app_settings")
    .upsert(
      { key, value, updated_by: actorId, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}

export async function saveBackupSettings(
  admin: Admin,
  settings: BackupSettings,
  actorId: string,
): Promise<void> {
  await upsertSetting(admin, BACKUP_SETTING_KEYS.enabled, settings.enabled ? "true" : "false", actorId);
  await upsertSetting(admin, BACKUP_SETTING_KEYS.hour, String(settings.hourJst), actorId);
  await upsertSetting(admin, BACKUP_SETTING_KEYS.retention, String(settings.retention), actorId);
}

/**
 * 自動バックアップの実行権を取得する（compare-and-set）。Vercel Cron は同じ予定を
 * 重複して呼ぶことがあるため、読んだ時点の updated_at から変わっていない場合のみ
 * 書き換えに成功する（同時に 2 つ呼ばれても片方だけが true になる）。
 */
export async function claimScheduledRun(
  admin: Admin,
  prevVersion: string | null,
  next: ScheduledState,
): Promise<boolean> {
  const key = BACKUP_SETTING_KEYS.scheduledState;
  const value = JSON.stringify(next);
  const updated_at = new Date().toISOString();

  if (prevVersion != null) {
    const { data, error } = await admin
      .from("app_settings")
      .update({ value, updated_at })
      .eq("key", key)
      .eq("updated_at", prevVersion)
      .select("key");
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1;
  }

  // 初回（行がまだ無い）。主キー重複なら別の呼び出しが先に登録した。
  const { error: insErr } = await admin.from("app_settings").insert({ key, value, updated_at });
  if (!insErr) return true;
  if (insErr.code === "23505") return false; // 別の呼び出しが先に登録した
  throw new Error(insErr.message);
}

export async function saveScheduledState(admin: Admin, state: ScheduledState): Promise<void> {
  await upsertSetting(admin, BACKUP_SETTING_KEYS.scheduledState, JSON.stringify(state), null);
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

async function discoverTables(): Promise<{ tables: TableSpec[]; warning: string | null }> {
  const fallback = Object.entries(KNOWN_TABLES).map(([name, primaryKey]) => ({
    name,
    primaryKey,
    uuidKey: false,
  }));
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase の接続情報が未設定です");
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spec = await res.json();
    const defs: Record<string, any> = spec?.definitions ?? {};

    const tables: TableSpec[] = Object.keys(defs)
      .filter((name) => !EXCLUDED_RELATIONS.has(name) && !name.startsWith("v_"))
      .sort()
      .map((name) => {
        const props: Record<string, any> = defs[name]?.properties ?? {};
        const pk = Object.keys(props).filter((col) =>
          String(props[col]?.description ?? "").includes("<pk/>"),
        );
        return {
          name,
          primaryKey: pk.length > 0 ? pk : (KNOWN_TABLES[name] ?? Object.keys(props).slice(0, 1)),
          uuidKey: pk.length === 1 && props[pk[0]]?.format === "uuid",
        };
      });
    if (tables.length === 0) throw new Error("テーブル定義が空です");

    const missing = Object.keys(KNOWN_TABLES).filter((n) => !tables.some((t) => t.name === n));
    return {
      tables,
      warning: missing.length > 0 ? `既知のテーブルが見つかりませんでした: ${missing.join(", ")}` : null,
    };
  } catch (e) {
    return {
      tables: fallback,
      warning: `テーブル一覧の自動取得に失敗したため、既知のテーブルのみ保存しました（${errorMessage(e)}）`,
    };
  }
}

/**
 * 単一列の主キーはキーセット方式（pk > 前ページ末尾）で辿る。稼働中に行が追加・削除されても
 * offset 方式のようにページ境界で行が重複・欠落しない。range 指定時は [lower, upper) のみ読む。
 */
async function readKeyset(
  admin: Admin,
  table: TableSpec,
  range: [string | null, string | null] | null,
  deadline: number,
): Promise<any[]> {
  const pk = table.primaryKey[0];
  const rows: any[] = [];
  let last: unknown = undefined;
  for (;;) {
    assertBeforeDeadline(deadline);
    let q: any = admin.from(table.name).select("*");
    if (last !== undefined) q = q.gt(pk, last);
    else if (range?.[0]) q = q.gte(pk, range[0]);
    if (range?.[1]) q = q.lt(pk, range[1]);
    const { data, error } = await q.order(pk, { ascending: true }).limit(PG_MAX_ROWS);
    if (error) throw new Error(`${table.name} の読み出しに失敗しました: ${error.message}`);
    const chunk = (data ?? []) as any[];
    rows.push(...chunk);
    if (chunk.length < PG_MAX_ROWS) break;
    last = chunk[chunk.length - 1][pk];
  }
  return rows;
}

/** 複合主キー（または主キーなし）のテーブル用。現状の public スキーマには該当なし。 */
async function readByOffset(admin: Admin, table: TableSpec, deadline: number): Promise<any[]> {
  const { rows, error } = await fetchAllRows<any>((from, to) => {
    assertBeforeDeadline(deadline);
    let q: any = admin.from(table.name).select("*");
    // ページ境界を安定させるため主キー順に並べる。
    for (const col of table.primaryKey) q = q.order(col, { ascending: true });
    return q.range(from, to);
  });
  if (error) throw new Error(`${table.name} の読み出しに失敗しました: ${error.message ?? error}`);
  return rows;
}

/**
 * 関数の実行時間上限（maxDuration=60 秒）で強制終了されると結果も記録されないため、
 * 読み出しが長引いた場合は手前で打ち切り、失敗として記録できるようにする。
 */
function assertBeforeDeadline(deadline: number): void {
  if (Date.now() > deadline) {
    throw new Error(
      "データ量が多く制限時間内に読み出しを完了できませんでした（Vercel の関数実行時間の上限）。",
    );
  }
}

async function countRows(admin: Admin, name: string): Promise<number> {
  const { count, error } = await admin.from(name).select("*", { count: "exact", head: true });
  return error ? 0 : (count ?? 0);
}

/**
 * 全テーブルを読み出す（戻り値は tables と同じ順）。
 * 関数の実行時間上限（60 秒）に余裕を持たせるため、行数の多い uuid 主キーのテーブルは
 * キー範囲で分割して並行に読む（例: audit_logs は 1,000 行 ≒ 1.4 秒 × 18 ページかかる）。
 */
async function exportTables(admin: Admin, tables: TableSpec[], deadline: number): Promise<any[][]> {
  const counts = await mapWithConcurrency(tables, READ_CONCURRENCY, (t) =>
    t.uuidKey ? countRows(admin, t.name) : Promise.resolve(0),
  );

  type Task = {
    tableIndex: number;
    partIndex: number;
    weight: number;
    range: [string | null, string | null] | null;
  };
  const tasks: Task[] = [];
  const partCounts: number[] = [];
  tables.forEach((t, tableIndex) => {
    const split = t.uuidKey && counts[tableIndex] > PARTITION_MIN_ROWS;
    const ranges = split ? uuidRangeBounds(UUID_PARTITIONS) : [null];
    partCounts[tableIndex] = ranges.length;
    ranges.forEach((range, partIndex) =>
      tasks.push({ tableIndex, partIndex, weight: counts[tableIndex] / ranges.length, range }),
    );
  });
  // 重い読み出しから着手して全体の所要時間を縮める。
  tasks.sort((a, b) => b.weight - a.weight);

  const parts: any[][][] = partCounts.map((n) => new Array(n));
  await mapWithConcurrency(tasks, READ_CONCURRENCY, async (task) => {
    const t = tables[task.tableIndex];
    parts[task.tableIndex][task.partIndex] =
      t.primaryKey.length === 1
        ? await readKeyset(admin, t, task.range, deadline)
        : await readByOffset(admin, t, deadline);
  });
  // 範囲は昇順に並んでいるので、連結すれば主キー順になる。
  return parts.map((p) => p.flat());
}

/** 認証ユーザー（auth.users）。パスワードのハッシュは Admin API では取得できないため含まれない。 */
async function exportAuthUsers(admin: Admin): Promise<any[]> {
  const users: any[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_USERS_PER_PAGE });
    if (error) throw new Error(`認証ユーザーの読み出しに失敗しました: ${error.message}`);
    const chunk = data?.users ?? [];
    users.push(...chunk);
    if (chunk.length < AUTH_USERS_PER_PAGE) break;
  }
  return users;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export type DatabaseDump = {
  json: Buffer;
  tableCount: number;
  rowCount: number;
  authUserCount: number;
  warnings: string[];
};

/** 全テーブル＋認証ユーザーを読み出して JSON（database.json の中身）を作る（読み取りのみ・保存はしない）。 */
export async function buildDatabaseDump(
  admin: Admin,
  meta: { createdAt: Date; trigger: BackupTrigger; createdBy: string | null },
  deadline: number = Date.now() + READ_BUDGET_MS,
): Promise<DatabaseDump> {
  const { tables, warning } = await discoverTables();
  const warnings = warning ? [warning] : [];

  const tableRows = await exportTables(admin, tables, deadline);
  const authUsers = await exportAuthUsers(admin);

  const data: Record<string, any[]> = {};
  tables.forEach((t, i) => {
    data[t.name] = tableRows[i];
  });
  const rowCount = tableRows.reduce((sum, rows) => sum + rows.length, 0);

  const payload = {
    format: "retouch-db-backup",
    version: 1,
    created_at: meta.createdAt.toISOString(),
    trigger: meta.trigger,
    created_by: meta.createdBy,
    source: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    tables: tables.map((t, i) => ({
      name: t.name,
      primary_key: t.primaryKey,
      row_count: tableRows[i].length,
    })),
    auth_users_count: authUsers.length,
    warnings,
    data,
    auth_users: authUsers,
  };

  return {
    json: Buffer.from(JSON.stringify(payload), "utf8"),
    tableCount: tables.length,
    rowCount,
    authUserCount: authUsers.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// フルバックアップ（1 ファイルの .tar.gz）
//
//   manifest.json        … 形式・作成日時・内容の件数（復元スクリプトが最初に読む）
//   database.json        … DB の全テーブル＋認証ユーザー（buildDatabaseDump の出力）
//   files/public/...     … 公開アップロードファイル（<FILE_STORAGE_DIR>/public/ と同じ構成）
//   files/community/...  … コミュニティ添付ファイル（<FILE_STORAGE_DIR>/community/ と同じ構成）
//
// 復元: `npx tsx scripts/restore-backup.ts backups/<ファイル名>`（手順は README の「バックアップと復元」）。
// ---------------------------------------------------------------------------

export const FULL_BACKUP_FORMAT = "retouch-full-backup";

export type FullBackupStats = {
  bytes: number;
  rawDbBytes: number;
  fileCount: number;
  fileBytes: number;
};

export async function writeFullBackup(
  dest: string,
  dump: DatabaseDump,
  meta: { createdAt: Date; trigger: BackupTrigger; createdBy: string | null },
): Promise<FullBackupStats> {
  const areas = await Promise.all(
    STORAGE_AREAS.map(async (area) => ({ area, files: await listFiles(area) })),
  );
  const fileCount = areas.reduce((n, a) => n + a.files.length, 0);
  const fileBytes = areas.reduce((n, a) => n + a.files.reduce((m, f) => m + f.size, 0), 0);

  const manifest = {
    format: FULL_BACKUP_FORMAT,
    version: 2,
    created_at: meta.createdAt.toISOString(),
    trigger: meta.trigger,
    created_by: meta.createdBy,
    source: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    database: {
      path: "database.json",
      tables: dump.tableCount,
      rows: dump.rowCount,
      auth_users: dump.authUserCount,
    },
    files: Object.fromEntries(
      areas.map((a) => [
        a.area,
        {
          path: `files/${a.area}/`,
          count: a.files.length,
          bytes: a.files.reduce((m, f) => m + f.size, 0),
        },
      ]),
    ),
    restore: "npx tsx scripts/restore-backup.ts <このファイル>",
  };

  const gz = createGzip({ level: 6 });
  const out = createWriteStream(dest);
  const done = pipeline(gz, out);
  const tar = new TarWriter(gz);
  try {
    await tar.addBuffer("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), meta.createdAt);
    await tar.addBuffer("database.json", dump.json, meta.createdAt);
    for (const { area, files } of areas) {
      for (const f of files) {
        await tar.addFile(`files/${area}/${f.rel}`, f.full, f.size, f.mtime);
      }
    }
    await tar.finish();
    await done;
  } catch (e) {
    gz.destroy();
    await done.catch(() => undefined);
    throw e;
  }

  const { size } = await stat(dest);
  return { bytes: size, rawDbBytes: dump.json.length, fileCount, fileBytes };
}

// ---------------------------------------------------------------------------
// 保存先（VPS のローカル backups/ フォルダ）
// ---------------------------------------------------------------------------

export function backupDir(): string {
  const configured = process.env.BACKUP_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), BACKUP_FOLDER);
}

/** 正規のファイル名であることを確認した上で、backups/ 内の絶対パスを返す。 */
export function backupFilePath(name: string): string {
  if (!parseBackupFileName(name)) throw new Error("不正なファイル名です");
  return path.join(backupDir(), name);
}

export async function listBackups(_admin?: Admin): Promise<{ files: BackupFile[]; error: string | null }> {
  let entries: string[];
  try {
    entries = await readdir(backupDir());
  } catch (e: any) {
    // 初回バックアップ前はフォルダ自体が無い。
    if (e?.code === "ENOENT") return { files: [], error: null };
    return { files: [], error: errorMessage(e) };
  }

  const files: BackupFile[] = [];
  for (const name of entries) {
    const parsed = parseBackupFileName(name);
    if (!parsed) continue;
    let size: number | null = null;
    try {
      const s = await stat(path.join(backupDir(), name));
      if (!s.isFile()) continue;
      size = s.size;
    } catch {
      continue;
    }
    files.push({ name, createdAt: parsed.createdAt.toISOString(), trigger: parsed.trigger, size });
  }

  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { files, error: null };
}

export async function deleteBackup(_admin: Admin | null, name: string): Promise<void> {
  try {
    await unlink(backupFilePath(name));
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
}

async function pruneScheduledBackups(retention: number): Promise<string[]> {
  const { files, error } = await listBackups();
  if (error) throw new Error(error);
  const expired = selectExpiredBackups(
    files.map((f) => f.name),
    retention,
  );
  for (const name of expired) await deleteBackup(null, name);
  return expired;
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

/**
 * バックアップを 1 回実行して VPS の backups/ に 1 ファイル（.tar.gz）保存し、
 * 結果を app_settings と監査ログに記録する。
 * 失敗しても例外は投げず { ok: false } を返す（呼び出し側で HTTP ステータスを決める）。
 */
export async function runBackup(
  admin: Admin,
  opts: {
    trigger: BackupTrigger;
    actorId?: string | null;
    actorEmail?: string | null;
    /** 自動バックアップ時の保存世代数。指定時は超過分の古い自動バックアップを削除する。 */
    retention?: number;
  },
): Promise<BackupRunResult> {
  const startedAt = new Date();
  const actorId = opts.actorId ?? null;
  let result: BackupRunResult;

  try {
    const meta = { createdAt: startedAt, trigger: opts.trigger, createdBy: opts.actorEmail ?? null };
    const dump = await buildDatabaseDump(admin, meta);

    const file = backupFileName(startedAt, opts.trigger);
    const dest = backupFilePath(file);
    await mkdir(path.dirname(dest), { recursive: true });
    // 書き込み途中のファイルが一覧に出ないよう、別名で書いてから置き換える
    // （自動は同日 1 ファイルのため再試行時は上書き）。
    const partial = `${dest}.partial`;
    let stats: FullBackupStats;
    try {
      stats = await writeFullBackup(partial, dump, meta);
      await rename(partial, dest);
    } catch (e) {
      await unlink(partial).catch(() => undefined);
      throw new Error(`バックアップファイルの保存に失敗しました: ${errorMessage(e)}`);
    }

    const warnings = [...dump.warnings];

    let pruned: string[] = [];
    if (opts.trigger === "scheduled" && opts.retention) {
      try {
        pruned = await pruneScheduledBackups(opts.retention);
      } catch (e) {
        // 古い世代の削除失敗でバックアップ自体を失敗扱いにはしない。
        warnings.push(`古いバックアップの削除に失敗しました: ${errorMessage(e)}`);
      }
    }

    result = {
      ok: true,
      file,
      bytes: stats.bytes,
      rawBytes: stats.rawDbBytes,
      tableCount: dump.tableCount,
      rowCount: dump.rowCount,
      authUserCount: dump.authUserCount,
      fileCount: stats.fileCount,
      fileBytes: stats.fileBytes,
      durationMs: Date.now() - startedAt.getTime(),
      warnings,
      pruned,
    };
  } catch (e) {
    result = { ok: false, error: errorMessage(e), durationMs: Date.now() - startedAt.getTime() };
  }

  const lastRun: LastRun = result.ok
    ? {
        at: startedAt.toISOString(),
        trigger: opts.trigger,
        ok: true,
        file: result.file,
        bytes: result.bytes,
        rows: result.rowCount,
        tables: result.tableCount,
        auth_users: result.authUserCount,
        files: result.fileCount,
        file_bytes: result.fileBytes,
        duration_ms: result.durationMs,
        warnings: result.warnings,
      }
    : {
        at: startedAt.toISOString(),
        trigger: opts.trigger,
        ok: false,
        duration_ms: result.durationMs,
        error: result.error,
      };
  try {
    await upsertSetting(admin, BACKUP_SETTING_KEYS.lastRun, JSON.stringify(lastRun), actorId);
  } catch (e) {
    console.error("[dbBackup] failed to record last run:", errorMessage(e));
  }

  await writeAudit({
    actorId,
    action: result.ok ? "backup.run" : "backup.run_failed",
    // audit_logs.target_id は uuid 型のため、ファイル名は meta に入れる。
    targetTable: BACKUP_TARGET,
    meta: {
      trigger: opts.trigger,
      ...(result.ok
        ? {
            file: result.file,
            bytes: result.bytes,
            rows: result.rowCount,
            tables: result.tableCount,
            auth_users: result.authUserCount,
            files: result.fileCount,
            file_bytes: result.fileBytes,
            pruned: result.pruned,
            warnings: result.warnings,
          }
        : { error: result.error }),
      duration_ms: result.durationMs,
    },
  });

  return result;
}
