/**
 * データベースのバックアップ（管理画面「DBバックアップ」と自動バックアップ cron から利用）。
 *
 * Vercel の関数では pg_dump が使えないため、サービスロールで public スキーマの
 * 全テーブルを PostgREST 経由で全件読み出し、認証ユーザー一覧と合わせて
 * gzip 圧縮した JSON 1 ファイルにまとめ、Supabase Storage の非公開バケットに保存する。
 *
 * - 読み取りのみ（既存テーブルへの書き込みは app_settings の db_backup.* キーだけ）。
 * - 会員の個人情報を含むため、バケットは必ず非公開。ダウンロードは短時間の署名付きURLのみ。
 * - テーブル間で完全に同一時点のスナップショットではない（数十秒の取得中の更新は混在しうる）。
 */
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PG_MAX_ROWS, fetchAllRows } from "./fetchAll";
import { writeAudit } from "./audit";
import {
  type BackupSettings,
  type BackupTrigger,
  type ScheduledState,
  backupFileName,
  parseBackupFileName,
  parseBackupSettings,
  parseScheduledState,
  selectExpiredBackups,
  uuidRangeBounds,
} from "./dbBackupSchedule";

const gzipAsync = promisify(gzip);

type Admin = SupabaseClient<any, any, any>;

export const BACKUP_BUCKET = "db-backups";

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

export type BackupArchive = {
  gz: Buffer;
  rawBytes: number;
  tableCount: number;
  rowCount: number;
  authUserCount: number;
  warnings: string[];
};

/** 全テーブル＋認証ユーザーを読み出して gzip 済み JSON を作る（読み取りのみ・保存はしない）。 */
export async function buildBackupArchive(
  admin: Admin,
  meta: { createdAt: Date; trigger: BackupTrigger; createdBy: string | null },
  deadline: number = Date.now() + READ_BUDGET_MS,
): Promise<BackupArchive> {
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

  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const gz = await gzipAsync(json, { level: 6 });
  return {
    gz,
    rawBytes: json.length,
    tableCount: tables.length,
    rowCount,
    authUserCount: authUsers.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** 非公開バケットを用意する（無ければ作成、誤って公開されていれば非公開に戻す）。 */
async function ensureBucket(admin: Admin): Promise<void> {
  const { data } = await admin.storage.getBucket(BACKUP_BUCKET);
  if (data) {
    if (data.public) {
      const { error } = await admin.storage.updateBucket(BACKUP_BUCKET, { public: false });
      if (error) throw new Error(`バックアップ用バケットを非公開にできませんでした: ${error.message}`);
    }
    return;
  }
  const { error } = await admin.storage.createBucket(BACKUP_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`バックアップ用バケットを作成できませんでした: ${error.message}`);
  }
}

export async function listBackups(admin: Admin): Promise<{ files: BackupFile[]; error: string | null }> {
  const { data, error } = await admin.storage
    .from(BACKUP_BUCKET)
    .list("", { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if (error) {
    // 初回バックアップ前はバケット自体が無い。
    if (/not found/i.test(error.message)) return { files: [], error: null };
    return { files: [], error: error.message };
  }
  const files: BackupFile[] = [];
  for (const obj of data ?? []) {
    const parsed = parseBackupFileName(obj.name);
    if (!parsed) continue;
    const size = Number((obj as any).metadata?.size);
    files.push({
      name: obj.name,
      createdAt: parsed.createdAt.toISOString(),
      trigger: parsed.trigger,
      size: Number.isFinite(size) ? size : null,
    });
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { files, error: null };
}

export async function createBackupDownloadUrl(admin: Admin, name: string): Promise<string> {
  if (!parseBackupFileName(name)) throw new Error("不正なファイル名です");
  const { data, error } = await admin.storage
    .from(BACKUP_BUCKET)
    .createSignedUrl(name, 60, { download: name });
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "ダウンロードURLを発行できませんでした");
  }
  return data.signedUrl;
}

export async function deleteBackup(admin: Admin, name: string): Promise<void> {
  if (!parseBackupFileName(name)) throw new Error("不正なファイル名です");
  const { error } = await admin.storage.from(BACKUP_BUCKET).remove([name]);
  if (error) throw new Error(error.message);
}

async function pruneScheduledBackups(admin: Admin, retention: number): Promise<string[]> {
  const { files, error } = await listBackups(admin);
  if (error) throw new Error(error);
  const expired = selectExpiredBackups(
    files.map((f) => f.name),
    retention,
  );
  if (expired.length === 0) return [];
  const { error: rmErr } = await admin.storage.from(BACKUP_BUCKET).remove(expired);
  if (rmErr) throw new Error(rmErr.message);
  return expired;
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

/**
 * バックアップを 1 回実行して Storage に保存し、結果を app_settings と監査ログに記録する。
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
    await ensureBucket(admin);
    const archive = await buildBackupArchive(admin, {
      createdAt: startedAt,
      trigger: opts.trigger,
      createdBy: opts.actorEmail ?? null,
    });

    const file = backupFileName(startedAt, opts.trigger);
    const { error: upErr } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(file, archive.gz, { contentType: "application/gzip", upsert: false });
    if (upErr) throw new Error(`バックアップファイルの保存に失敗しました: ${upErr.message}`);

    const warnings = [...archive.warnings];
    let pruned: string[] = [];
    if (opts.trigger === "scheduled" && opts.retention) {
      try {
        pruned = await pruneScheduledBackups(admin, opts.retention);
      } catch (e) {
        // 古い世代の削除失敗でバックアップ自体を失敗扱いにはしない。
        warnings.push(`古いバックアップの削除に失敗しました: ${errorMessage(e)}`);
      }
    }

    result = {
      ok: true,
      file,
      bytes: archive.gz.length,
      rawBytes: archive.rawBytes,
      tableCount: archive.tableCount,
      rowCount: archive.rowCount,
      authUserCount: archive.authUserCount,
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
    targetTable: "storage:" + BACKUP_BUCKET,
    meta: {
      trigger: opts.trigger,
      ...(result.ok
        ? {
            file: result.file,
            bytes: result.bytes,
            rows: result.rowCount,
            tables: result.tableCount,
            auth_users: result.authUserCount,
            pruned: result.pruned,
            warnings: result.warnings,
          }
        : { error: result.error }),
      duration_ms: result.durationMs,
    },
  });

  return result;
}
