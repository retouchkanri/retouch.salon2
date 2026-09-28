/**
 * バックアップからの復元（管理画面「DBバックアップ」で作成したファイルを使う）。
 *
 *   .tar.gz（現行のフルバックアップ）… アップロードファイル一式 + DB（全テーブル・認証ユーザー）
 *   .json.gz（旧形式）              … DB のみ
 *
 * 使い方（プロジェクト直下で。接続先は .env.local の Supabase）:
 *   npx tsx scripts/restore-backup.ts backups/<ファイル名>              … 内容の確認だけ（何も変更しない）
 *   npx tsx scripts/restore-backup.ts backups/<ファイル名> --apply      … ファイルと DB の両方を復元
 *
 * オプション:
 *   --files-only        アップロードファイルだけ復元（<FILE_STORAGE_DIR> に展開。同名は上書き）
 *   --db-only           DB だけ復元
 *   --tables=a,b        DB は指定したテーブルだけ復元
 *   --skip-auth         認証ユーザーの再作成をしない
 *
 * DB の復元は「バックアップの行を主キーで upsert」する（同じ主キーの行は上書き・バックアップに無い行は残る）。
 * 外部キーの順序は自動で解決する（失敗した行を後回しにして最大 6 回まで再試行）。
 * 新しい Supabase プロジェクトへ復元する場合は、先に supabase/apply_all.sql 等でスキーマを作成しておくこと。
 * 認証ユーザーは同じ ID で再作成するが、パスワードはバックアップに含まれない（Supabase の Admin API では
 * 取得できない）ため、再作成されたユーザーは「パスワードを忘れた方」から再設定が必要。
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { createGunzip, gunzipSync } from "node:zlib";
import { readTar } from "../src/lib/tarball";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const FILES = !args.includes("--db-only");
const DB = !args.includes("--files-only");
const SKIP_AUTH = args.includes("--skip-auth");
const ONLY_TABLES = (args.find((a) => a.startsWith("--tables="))?.slice("--tables=".length) ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!file) {
  console.error("使い方: npx tsx scripts/restore-backup.ts backups/<ファイル名> [--apply] [--files-only|--db-only] [--tables=a,b] [--skip-auth]");
  process.exit(1);
}

const STORAGE_ROOT = process.env.FILE_STORAGE_DIR?.trim()
  ? path.resolve(process.env.FILE_STORAGE_DIR.trim())
  : path.join(process.cwd(), "storage");
const AREAS = new Set(["public", "community"]);

function safeTarget(rel: string): string | null {
  const parts = rel.split("/");
  const area = parts.shift();
  if (!area || !AREAS.has(area) || parts.length === 0) return null;
  if (parts.some((p) => !p || p === "." || p === ".." || /[\u0000-\u001f<>:"|?*\\]/.test(p))) return null;
  const root = path.join(STORAGE_ROOT, area);
  const full = path.resolve(root, ...parts);
  return full.startsWith(root + path.sep) ? full : null;
}

// ---------------------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------------------

type Loaded = {
  manifest: any | null;
  database: any | null;
  files: { count: number; bytes: number; written: number; rejected: string[] };
};

async function load(filePath: string): Promise<Loaded> {
  const files = { count: 0, bytes: 0, written: 0, rejected: [] as string[] };
  if (filePath.endsWith(".json.gz")) {
    const database = JSON.parse(gunzipSync(await readFile(filePath)).toString("utf8"));
    return { manifest: null, database, files };
  }
  if (!filePath.endsWith(".tar.gz")) throw new Error(".tar.gz または .json.gz のバックアップファイルを指定してください");

  let manifest: any = null;
  let database: any = null;
  const writeFiles = APPLY && FILES;

  await readTar(createReadStream(filePath).pipe(createGunzip()), async (entry) => {
    if (entry.name === "manifest.json" || entry.name === "database.json") {
      const parts: Buffer[] = [];
      return {
        write: (c) => void parts.push(c),
        end: () => {
          const json = JSON.parse(Buffer.concat(parts).toString("utf8"));
          if (entry.name === "manifest.json") manifest = json;
          else database = json;
        },
      };
    }
    if (!entry.name.startsWith("files/")) return null;
    const rel = entry.name.slice("files/".length);
    const target = safeTarget(rel);
    if (!target) {
      files.rejected.push(entry.name);
      return null;
    }
    files.count++;
    files.bytes += entry.size;
    if (!writeFiles || !FILES) return null;
    await mkdir(path.dirname(target), { recursive: true });
    const out = createWriteStream(target);
    return {
      write: async (c) => {
        if (!out.write(c)) await once(out, "drain");
      },
      end: async () => {
        out.end();
        await once(out, "finish");
        files.written++;
      },
    };
  });
  if (manifest?.format !== "retouch-full-backup") throw new Error("manifest.json が見つからないか形式が違います");
  return { manifest, database, files };
}

// ---------------------------------------------------------------------------
// DB の復元
// ---------------------------------------------------------------------------

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local にありません");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
type Admin = ReturnType<typeof adminClient>;

async function restoreAuthUsers(admin: Admin, users: any[]): Promise<void> {
  const existing = new Set<string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`認証ユーザー一覧の取得に失敗: ${error.message}`);
    for (const u of data.users) existing.add(u.id);
    if (data.users.length < 1000) break;
  }
  let created = 0;
  const failed: string[] = [];
  for (const u of users) {
    if (!u?.id || existing.has(u.id)) continue;
    const { error } = await admin.auth.admin.createUser({
      id: u.id,
      email: u.email ?? undefined,
      phone: u.phone || undefined,
      email_confirm: Boolean(u.email_confirmed_at),
      phone_confirm: Boolean(u.phone_confirmed_at),
      user_metadata: u.user_metadata ?? {},
      app_metadata: u.app_metadata ?? {},
      // パスワードはバックアップに無いため推測不能な値を設定（本人がパスワード再設定で変更する）。
      password: randomBytes(24).toString("base64url"),
    });
    if (error) failed.push(`${u.email ?? u.id}: ${error.message}`);
    else created++;
  }
  console.log(`  認証ユーザー: 既存 ${existing.size} 件・再作成 ${created} 件・失敗 ${failed.length} 件`);
  for (const f of failed.slice(0, 30)) console.log(`    ✗ ${f}`);
}

type Pending = { name: string; pk: string[]; rows: any[] };

const isFkError = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "23503" || /foreign key/i.test(e.message ?? ""));

async function restoreTables(admin: Admin, pending: Pending[]): Promise<void> {
  const errors: string[] = [];
  const restored = new Map<string, number>();
  for (let pass = 1; pass <= 6 && pending.length > 0; pass++) {
    const deferred: Pending[] = [];
    for (const t of pending) {
      const onConflict = t.pk.join(",");
      const later: any[] = [];
      for (let i = 0; i < t.rows.length; i += 500) {
        const batch = t.rows.slice(i, i + 500);
        const { error } = await admin.from(t.name).upsert(batch, { onConflict });
        if (!error) {
          restored.set(t.name, (restored.get(t.name) ?? 0) + batch.length);
          continue;
        }
        if (!isFkError(error)) {
          errors.push(`${t.name}: ${error.message}`);
          continue;
        }
        // 外部キー待ちの行だけを後回しにする（同じテーブル内の親子関係もこれで解決する）。
        for (const row of batch) {
          const { error: rowErr } = await admin.from(t.name).upsert(row, { onConflict });
          if (!rowErr) restored.set(t.name, (restored.get(t.name) ?? 0) + 1);
          else if (isFkError(rowErr)) later.push(row);
          else errors.push(`${t.name}: ${rowErr.message}`);
        }
      }
      if (later.length > 0) deferred.push({ ...t, rows: later });
    }
    if (deferred.length > 0) {
      const n = deferred.reduce((s, t) => s + t.rows.length, 0);
      console.log(`  （${pass} 回目: 外部キー待ち ${n} 行を後回し）`);
    }
    pending = deferred;
  }
  for (const [name, n] of [...restored].sort()) console.log(`  ${name}: ${n} 行`);
  for (const t of pending) errors.push(`${t.name}: 外部キーを解決できない行 ${t.rows.length} 件`);
  const unique = [...new Set(errors)];
  if (unique.length > 0) {
    console.log(`  ⚠ エラー ${unique.length} 件:`);
    for (const e of unique.slice(0, 50)) console.log(`    ✗ ${e}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const filePath = path.resolve(file!);
  console.log(`バックアップ: ${filePath}`);
  console.log(`復元先 Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(未設定)"}`);
  console.log(`復元先ファイル: ${STORAGE_ROOT}`);
  console.log(`モード: ${APPLY ? "復元を実行（--apply）" : "確認のみ（何も変更しません）"}\n`);

  const { manifest, database, files } = await load(filePath);
  if (manifest) {
    console.log(`作成日時: ${manifest.created_at}（${manifest.trigger}、作成元 ${manifest.source ?? "-"}）`);
  }
  if (database) {
    console.log(
      `DB: ${database.tables?.length ?? 0} テーブル・${(database.tables ?? []).reduce((s: number, t: any) => s + (t.row_count ?? 0), 0)} 行・認証ユーザー ${database.auth_users?.length ?? 0} 件`,
    );
  } else {
    console.log("DB: 含まれていません");
  }
  console.log(`ファイル: ${files.count} 件（${(files.bytes / 1024 / 1024).toFixed(1)} MB）`);
  if (files.rejected.length > 0) console.log(`  ⚠ 不正なパスのため無視: ${files.rejected.length} 件`);

  if (!APPLY) {
    console.log("\n確認のみで終了しました。復元する場合は --apply を付けて再実行してください。");
    return;
  }

  if (FILES) console.log(`\nファイルを復元しました: ${files.written} 件 → ${STORAGE_ROOT}`);

  if (DB && database) {
    if (database.format !== "retouch-db-backup") throw new Error("database.json の形式が違います");
    const admin = adminClient();
    console.log("\nDB を復元しています…");
    if (!SKIP_AUTH && ONLY_TABLES.length === 0) await restoreAuthUsers(admin, database.auth_users ?? []);
    const pending: Pending[] = (database.tables ?? [])
      .filter((t: any) => ONLY_TABLES.length === 0 || ONLY_TABLES.includes(t.name))
      .map((t: any) => ({ name: t.name, pk: t.primary_key, rows: database.data?.[t.name] ?? [] }))
      .filter((t: Pending) => t.rows.length > 0);
    await restoreTables(admin, pending);
  }
  console.log("\n完了しました。");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
