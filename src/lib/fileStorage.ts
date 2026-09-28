/**
 * アップロードファイルの保存先（VPS のローカルディスク）。
 *
 * ファイル本体はすべてこのサーバーのディスクに置き、Supabase の DB にはパスだけを保存する。
 *
 *   <FILE_STORAGE_DIR>/public/<path>     … 公開ファイル（アバター・馬画像・お知らせ／会員向けメッセージの画像・PDF）
 *                                          → `/uploads/<path>` で配信（src/app/uploads/[...path]/route.ts）。
 *                                          DB には `/uploads/<path>` を保存する。
 *   <FILE_STORAGE_DIR>/community/<path>  … コミュニティ（チャット）の添付ファイル。非公開。
 *                                          `<channel_id>/<user_id>/<file>` 形式。DB（community_messages.attachments）には
 *                                          このパスだけを保存し、閲覧は権限確認付きの /api/community/files/<path> 経由。
 *
 * 旧構成では Supabase Storage の avatars バケット（公開）と community バケット（非公開）に置いていた。
 * パスはバケット内のオブジェクトパスと同じにしてあるため、scripts/migrate-storage-to-vps.ts で
 * そのまま移せる。バックアップ（dbBackup.ts）はこのフォルダ全体を DB と一緒に 1 ファイルへまとめる。
 *
 * サーバー専用（node:fs を使う）。ブラウザ側のコードから import しないこと。
 */
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export type StorageArea = "public" | "community";

export const STORAGE_AREAS: readonly StorageArea[] = ["public", "community"];

/** 公開ファイルの URL パスの接頭辞（DB にはこの形式で保存する）。 */
export const PUBLIC_URL_PREFIX = "/uploads/";

/** ファイル保存先のルート。既定はプロジェクト直下の `storage/`。 */
export function storageRoot(): string {
  const configured = process.env.FILE_STORAGE_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "storage");
}

export function areaRoot(area: StorageArea): string {
  return path.join(storageRoot(), area);
}

/**
 * 相対パス（`a/b/c.png`）を検証して正規化する。`..`・絶対パス・空の要素・制御文字は拒否（null）。
 */
export function normalizeRelPath(rel: string): string | null {
  if (typeof rel !== "string") return null;
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.length > 1024) return null;
  const parts = cleaned.split("/");
  for (const p of parts) {
    if (!p || p === "." || p === "..") return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(p)) return null;
  }
  return parts.join("/");
}

/** 保存領域内の絶対パス。領域外を指す場合は例外。 */
export function resolveStoragePath(area: StorageArea, rel: string): string {
  const normalized = normalizeRelPath(rel);
  if (!normalized) throw new Error("不正なファイルパスです");
  const root = areaRoot(area);
  const full = path.resolve(root, ...normalized.split("/"));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("不正なファイルパスです");
  return full;
}

/** ファイルを保存する（フォルダは自動作成・同名は上書き）。 */
export async function saveFile(area: StorageArea, rel: string, data: Buffer | Uint8Array): Promise<void> {
  const full = resolveStoragePath(area, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

/** ファイルを削除する。存在しなければ何もしない。 */
export async function deleteFile(area: StorageArea, rel: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(area, rel));
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
}

/** フォルダごと削除する（コミュニティのチャンネル削除時など）。 */
export async function deleteFolder(area: StorageArea, rel: string): Promise<void> {
  await rm(resolveStoragePath(area, rel), { recursive: true, force: true });
}

export async function fileSize(area: StorageArea, rel: string): Promise<number | null> {
  try {
    const s = await stat(resolveStoragePath(area, rel));
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

/** 領域内の全ファイルを列挙する（相対パスは `/` 区切り）。 */
export async function listFiles(area: StorageArea): Promise<{ rel: string; full: string; size: number; mtime: Date }[]> {
  const root = areaRoot(area);
  const out: { rel: string; full: string; size: number; mtime: Date }[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e: any) {
      if (e?.code === "ENOENT") return;
      throw e;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(full, rel);
      else if (ent.isFile()) {
        const s = await stat(full);
        out.push({ rel, full, size: s.size, mtime: s.mtime });
      }
    }
  }
  await walk(root, "");
  return out;
}

// ---------------------------------------------------------------------------
// 公開 URL と保存パスの変換
// ---------------------------------------------------------------------------

/** 公開ファイルの DB 保存用パス（例: `/uploads/horses/123.png`）。 */
export function publicFilePath(rel: string): string {
  const normalized = normalizeRelPath(rel);
  if (!normalized) throw new Error("不正なファイルパスです");
  return PUBLIC_URL_PREFIX + normalized.split("/").map(encodeURIComponent).join("/");
}

/** 旧 Supabase Storage の公開 URL の接頭辞（avatars バケット）。 */
export function legacyPublicUrlPrefix(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}/storage/v1/object/public/avatars/` : null;
}

// ---------------------------------------------------------------------------
// 配信
// ---------------------------------------------------------------------------

/**
 * 拡張子 → Content-Type。ここに無い拡張子は application/octet-stream（ダウンロード扱い）で返し、
 * HTML や SVG などブラウザがスクリプトを実行しうる形式は決してインライン表示しない。
 */
const INLINE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
};

const DOWNLOAD_TYPES: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** MIME タイプ → 保存時の拡張子（ファイル名の拡張子は信用せず、検証済みの MIME から決める）。 */
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export function extensionForType(type: string): string | null {
  return EXT_BY_TYPE[type] ?? null;
}

/**
 * ファイル名の拡張子を MIME タイプに合わせる（`photo.JPG` + image/jpeg → そのまま、
 * `report` + application/pdf → `report.pdf`）。配信時の Content-Type は拡張子で決まるため。
 */
export function withTypeExtension(name: string, type: string): string {
  const want = extensionForType(type);
  if (!want) return name;
  const current = extOf(name);
  const same = current === want || (want === "jpg" && current === "jpeg");
  return same ? name : `${name}.${want}`;
}

/** 公開ファイルを保存し、DB に保存するパス（`/uploads/...`）を返す。 */
export async function savePublicUpload(rel: string, data: Buffer | Uint8Array): Promise<string> {
  await saveFile("public", rel, data);
  return publicFilePath(rel);
}

function extOf(rel: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(rel);
  return m ? m[1].toLowerCase() : "";
}

/** 保存済みファイルを HTTP レスポンスとして返す（存在しなければ null）。 */
export async function fileResponse(
  area: StorageArea,
  rel: string,
  opts: { cacheControl: string; downloadName?: string | null },
): Promise<Response | null> {
  let full: string;
  try {
    full = resolveStoragePath(area, rel);
  } catch {
    return null;
  }
  let size: number;
  try {
    const s = await stat(full);
    if (!s.isFile()) return null;
    size = s.size;
  } catch {
    return null;
  }

  const ext = extOf(rel);
  const inlineType = INLINE_TYPES[ext];
  const contentType = inlineType ?? DOWNLOAD_TYPES[ext] ?? "application/octet-stream";
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Length": String(size),
    "Cache-Control": opts.cacheControl,
    "X-Content-Type-Options": "nosniff",
  });
  const name = opts.downloadName?.trim() || path.posix.basename(rel);
  const encoded = encodeURIComponent(name);
  headers.set(
    "Content-Disposition",
    `${inlineType ? "inline" : "attachment"}; filename="${encoded}"; filename*=UTF-8''${encoded}`,
  );

  const body = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers });
}
