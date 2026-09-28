/**
 * 既存のアップロードファイルを Supabase Storage から VPS へ移し、DB の参照をパスに書き換える。
 *
 *   1. avatars バケット（公開）   → <FILE_STORAGE_DIR>/public/<同じパス>
 *      community バケット（非公開） → <FILE_STORAGE_DIR>/community/<同じパス>
 *      db-backups バケット          → backups/（旧形式の .json.gz バックアップ）
 *      ※ VPS に同じサイズのファイルが既にあれば取得しない（何度実行しても安全）。
 *   2. DB 内の旧公開URL
 *        https://<project>.supabase.co/storage/v1/object/public/avatars/<path>
 *      を VPS のパス `/uploads/<path>` に置き換える（全テーブル・全列を走査。audit_logs は履歴なので対象外）。
 *      コミュニティの添付は元からパスだけを保存しているため書き換え不要。
 *
 * 使い方（プロジェクト直下で）:
 *   npx tsx scripts/migrate-storage-to-vps.ts           … ファイルを取得し、DB の書き換え予定を表示（DB は変更しない）
 *   npx tsx scripts/migrate-storage-to-vps.ts --apply   … ファイル取得に加えて DB を書き換える
 *
 * --apply の前に、書き換える行の元の値を backups/storage-migration_<日時>.json に保存する（戻す場合に使う）。
 * 実行前に管理画面から手動バックアップも取っておくこと。
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local にありません");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STORAGE_ROOT = process.env.FILE_STORAGE_DIR?.trim()
  ? path.resolve(process.env.FILE_STORAGE_DIR.trim())
  : path.join(process.cwd(), "storage");
const BACKUP_DIR = process.env.BACKUP_DIR?.trim()
  ? path.resolve(process.env.BACKUP_DIR.trim())
  : path.join(process.cwd(), "backups");

const LEGACY_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/avatars/`;
const NEW_PREFIX = "/uploads/";
const SKIP_TABLES = new Set(["audit_logs"]);

// ---------------------------------------------------------------------------
// 1. ファイルの取得
// ---------------------------------------------------------------------------

type Obj = { path: string; size: number | null };

async function listBucket(bucket: string, prefix = ""): Promise<Obj[]> {
  const out: Obj[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      if (/not found/i.test(error.message)) return out;
      throw new Error(`${bucket}/${prefix} の一覧取得に失敗: ${error.message}`);
    }
    const items = data ?? [];
    for (const it of items) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id == null) out.push(...(await listBucket(bucket, p))); // フォルダ
      else if (it.name !== ".emptyFolderPlaceholder") {
        const size = Number((it as any).metadata?.size);
        out.push({ path: p, size: Number.isFinite(size) ? size : null });
      }
    }
    if (items.length < 1000) return out;
  }
}

function safeLocalPath(root: string, rel: string): string {
  const full = path.resolve(root, ...rel.split("/"));
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`不正なパス: ${rel}`);
  return full;
}

async function localSize(full: string): Promise<number | null> {
  try {
    return (await stat(full)).size;
  } catch {
    return null;
  }
}

async function pullBucket(bucket: string, root: string, filter: (p: string) => boolean = () => true) {
  const objects = (await listBucket(bucket)).filter((o) => filter(o.path));
  let fetched = 0;
  let skipped = 0;
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < objects.length) {
      const o = objects[next++];
      const dest = safeLocalPath(root, o.path.includes("/") && bucket === "db-backups" ? path.posix.basename(o.path) : o.path);
      const have = await localSize(dest);
      if (have != null && (o.size == null || have === o.size)) {
        skipped++;
        continue;
      }
      const { data, error } = await admin.storage.from(bucket).download(o.path);
      if (error || !data) {
        failed.push(`${o.path}（${error?.message ?? "no data"}）`);
        continue;
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await data.arrayBuffer()));
      fetched++;
      if (fetched % 50 === 0) console.log(`  … ${bucket}: ${fetched} 件取得`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`  ${bucket}: 全 ${objects.length} 件（新規取得 ${fetched}・取得済み ${skipped}・失敗 ${failed.length}）`);
  for (const f of failed) console.log(`    ✗ ${f}`);
  return { total: objects.length, failed };
}

// ---------------------------------------------------------------------------
// 2. DB の参照の書き換え
// ---------------------------------------------------------------------------

async function discoverTables(): Promise<{ name: string; pk: string[] }[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: "application/openapi+json" },
  });
  if (!res.ok) throw new Error(`テーブル一覧の取得に失敗: HTTP ${res.status}`);
  const spec = await res.json();
  const defs: Record<string, any> = spec?.definitions ?? {};
  return Object.keys(defs)
    .filter((n) => !n.startsWith("v_"))
    .sort()
    .map((name) => {
      const props: Record<string, any> = defs[name]?.properties ?? {};
      return {
        name,
        pk: Object.keys(props).filter((c) => String(props[c]?.description ?? "").includes("<pk/>")),
      };
    });
}

/** 値（文字列・配列・JSON）の中の旧URLを置き換える。変わらなければ undefined。 */
function rewrite(value: unknown, found: Set<string>): unknown {
  if (typeof value === "string") {
    if (!value.includes(LEGACY_PREFIX)) return undefined;
    const re = new RegExp(LEGACY_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^\\s\"'<>)?#]+)", "g");
    for (const m of value.matchAll(re)) {
      try {
        found.add(decodeURIComponent(m[1]));
      } catch {
        found.add(m[1]);
      }
    }
    return value.split(LEGACY_PREFIX).join(NEW_PREFIX);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const r = rewrite(v, found);
      if (r === undefined) return v;
      changed = true;
      return r;
    });
    return changed ? next : undefined;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = rewrite(v, found);
      next[k] = r === undefined ? v : r;
      if (r !== undefined) changed = true;
    }
    return changed ? next : undefined;
  }
  return undefined;
}

type Change = { table: string; pk: string; id: unknown; before: Record<string, unknown>; after: Record<string, unknown> };

async function scanDb(): Promise<{ changes: Change[]; referenced: Set<string>; skipped: string[] }> {
  const tables = await discoverTables();
  const changes: Change[] = [];
  const referenced = new Set<string>();
  const skipped: string[] = [];
  for (const t of tables) {
    if (SKIP_TABLES.has(t.name)) continue;
    const orderCol = t.pk[0];
    for (let from = 0; ; from += 1000) {
      let q = admin.from(t.name).select("*");
      if (orderCol) q = q.order(orderCol, { ascending: true });
      const { data, error } = await q.range(from, from + 999);
      if (error) throw new Error(`${t.name} の読み出しに失敗: ${error.message}`);
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [col, val] of Object.entries(row)) {
          const r = rewrite(val, referenced);
          if (r !== undefined) {
            before[col] = val;
            after[col] = r;
          }
        }
        if (Object.keys(after).length === 0) continue;
        if (t.pk.length !== 1) {
          skipped.push(`${t.name}（主キーが単一列でないため自動で書き換えできません）`);
          continue;
        }
        changes.push({ table: t.name, pk: t.pk[0], id: row[t.pk[0]], before, after });
      }
      if ((data ?? []).length < 1000) break;
    }
  }
  return { changes, referenced, skipped: [...new Set(skipped)] };
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`ファイル保存先: ${STORAGE_ROOT}`);
  console.log(`モード: ${APPLY ? "ファイル取得 + DB 書き換え（--apply）" : "ファイル取得のみ（DB は変更しない）"}\n`);

  console.log("1. Supabase Storage → VPS");
  const pub = await pullBucket("avatars", path.join(STORAGE_ROOT, "public"));
  const com = await pullBucket("community", path.join(STORAGE_ROOT, "community"));
  await pullBucket("db-backups", BACKUP_DIR, (p) => /(^|\/)db-backup_.*\.json\.gz$/.test(p));

  console.log("\n2. DB 内の旧URL（avatars バケットの公開URL）→ /uploads/...");
  const { changes, referenced, skipped } = await scanDb();
  const byCol = new Map<string, number>();
  for (const c of changes) for (const col of Object.keys(c.after)) {
    const k = `${c.table}.${col}`;
    byCol.set(k, (byCol.get(k) ?? 0) + 1);
  }
  if (byCol.size === 0) console.log("  書き換えが必要な値はありません。");
  for (const [k, n] of [...byCol].sort()) console.log(`  ${k}: ${n} 行`);
  for (const s of skipped) console.log(`  ⚠ ${s}`);

  const missing: string[] = [];
  for (const rel of referenced) {
    if ((await localSize(safeLocalPath(path.join(STORAGE_ROOT, "public"), rel))) == null) missing.push(rel);
  }
  if (missing.length > 0) {
    console.log(`  ⚠ DB が参照しているのに VPS に無いファイル ${missing.length} 件（Storage 側にも無い＝元から表示されていない可能性）:`);
    for (const m of missing.slice(0, 30)) console.log(`    - ${m}`);
    if (missing.length > 30) console.log(`    …ほか ${missing.length - 30} 件`);
  }

  if (!APPLY) {
    console.log(`\nDB は変更していません。書き換える場合は --apply を付けて再実行してください（${changes.length} 行）。`);
    return;
  }
  if (pub.failed.length > 0 || com.failed.length > 0) {
    console.error("\nファイルの取得に失敗したものがあるため、DB の書き換えを中止しました。再実行してください。");
    process.exit(1);
  }
  if (changes.length === 0) return;

  await mkdir(BACKUP_DIR, { recursive: true });
  const rollback = path.join(BACKUP_DIR, `storage-migration_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(rollback, JSON.stringify({ supabase: SUPABASE_URL, changes }, null, 2));
  console.log(`\n元の値を保存しました: ${rollback}`);

  let done = 0;
  const errors: string[] = [];
  for (const c of changes) {
    const { error } = await admin.from(c.table).update(c.after).eq(c.pk, c.id as any);
    if (error) errors.push(`${c.table} ${String(c.id)}: ${error.message}`);
    else done++;
  }
  console.log(`DB を書き換えました: ${done} / ${changes.length} 行`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  if (errors.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
