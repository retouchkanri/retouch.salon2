/**
 * 最小限の tar（ustar + pax 長いパス名）書き出し・読み込み。外部ライブラリ不要。
 *
 * バックアップ（DB の JSON とアップロードファイル一式）を 1 つの .tar.gz にまとめるために使う。
 * 出力は標準的な tar なので、Windows の `tar -xzf`・7-Zip・Linux の tar でもそのまま展開できる。
 */
import { createReadStream } from "node:fs";
import { once } from "node:events";
import type { Writable } from "node:stream";

const BLOCK = 512;

function writeString(buf: Buffer, offset: number, length: number, value: string): void {
  buf.write(value.slice(0, length), offset, length, "utf8");
}

function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
  const s = Math.floor(value).toString(8).padStart(length - 1, "0");
  buf.write(s + "\0", offset, length, "ascii");
}

function header(name: string, size: number, mtime: Date, type: "0" | "x"): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  writeString(h, 0, 100, name);
  writeOctal(h, 100, 8, 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, Math.floor(mtime.getTime() / 1000));
  h.fill(0x20, 148, 156); // チェックサム計算中は空白で埋める
  h.write(type, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

function padding(size: number): Buffer {
  const rest = size % BLOCK;
  return rest === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - rest, 0);
}

/** pax 拡張ヘッダのレコード（"<長さ> path=<値>\n"、長さは自身の桁数を含む）。 */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  const bodyLen = Buffer.byteLength(body, "utf8");
  let len = bodyLen + String(bodyLen).length;
  if (String(len).length + bodyLen !== len) len = bodyLen + String(len).length;
  return Buffer.from(`${len}${body}`, "utf8");
}

function needsPax(name: string): boolean {
  return Buffer.byteLength(name, "utf8") > 99 || /[^\x20-\x7e]/.test(name);
}

export class TarWriter {
  constructor(private readonly out: Writable) {}

  private async write(chunk: Buffer): Promise<void> {
    if (chunk.length === 0) return;
    if (!this.out.write(chunk)) await once(this.out, "drain");
  }

  private async writeHeader(name: string, size: number, mtime: Date): Promise<void> {
    if (needsPax(name)) {
      const pax = paxRecord("path", name);
      await this.write(header("PaxHeader/entry", pax.length, mtime, "x"));
      await this.write(pax);
      await this.write(padding(pax.length));
      // 通常ヘッダ側の名前は pax 非対応の展開ツール向けの代替（ASCII に丸めた末尾 99 バイト）。
      name = name.replace(/[^\x20-\x7e]/g, "_").slice(-99);
    }
    await this.write(header(name, size, mtime, "0"));
  }

  async addBuffer(name: string, data: Buffer, mtime: Date = new Date()): Promise<void> {
    await this.writeHeader(name, data.length, mtime);
    await this.write(data);
    await this.write(padding(data.length));
  }

  /** ディスク上のファイルを追加する。size は事前に stat した値（読み込み中に変わった場合も size ぶんだけ書く）。 */
  async addFile(name: string, fullPath: string, size: number, mtime: Date): Promise<void> {
    await this.writeHeader(name, size, mtime);
    let written = 0;
    if (size > 0) {
      for await (const chunk of createReadStream(fullPath, { start: 0, end: size - 1 })) {
        const b = chunk as Buffer;
        const take = b.subarray(0, Math.min(b.length, size - written));
        await this.write(take);
        written += take.length;
        if (written >= size) break;
      }
    }
    // 読み込み中にファイルが縮んだ場合もヘッダの size と一致させる。
    if (written < size) await this.write(Buffer.alloc(size - written, 0));
    await this.write(padding(size));
  }

  /** 終端（ゼロブロック 2 つ）を書いて出力を閉じる。 */
  async finish(): Promise<void> {
    await this.write(Buffer.alloc(BLOCK * 2, 0));
    this.out.end();
    await once(this.out, "finish");
  }
}

// ---------------------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------------------

export type TarEntry = { name: string; size: number; mtime: Date };

/** エントリ本体の受け取り先。null を返したエントリは読み飛ばす。 */
export type TarSink = {
  write(chunk: Buffer): void | Promise<void>;
  end(): void | Promise<void>;
};

function readString(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8");
}

function readOctal(buf: Buffer, offset: number, length: number): number {
  const s = readString(buf, offset, length).trim();
  return s ? parseInt(s, 8) : 0;
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space === -1) break;
    const len = parseInt(data.subarray(pos, space).toString("ascii"), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = data.subarray(space + 1, pos + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

/** tar ストリーム（展開済み）を読み、通常ファイルごとに onEntry を呼ぶ。 */
export async function readTar(
  input: AsyncIterable<Buffer | Uint8Array | string>,
  onEntry: (entry: TarEntry) => Promise<TarSink | null> | TarSink | null,
): Promise<void> {
  let buf: Buffer = Buffer.alloc(0);
  let nextPath: string | null = null;

  type Current = {
    remaining: number;
    pad: number;
    consume: (chunk: Buffer) => void | Promise<void>;
    done: () => void | Promise<void>;
  };
  let cur: Current | null = null;

  const collect = (onDone: (data: Buffer) => void): Pick<Current, "consume" | "done"> => {
    const parts: Buffer[] = [];
    return {
      consume: (c) => void parts.push(Buffer.from(c)),
      done: () => onDone(Buffer.concat(parts)),
    };
  };

  for await (const raw of input) {
    const chunk = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;

    for (;;) {
      if (cur) {
        if (cur.remaining > 0) {
          if (buf.length === 0) break;
          const n = Math.min(cur.remaining, buf.length);
          const part = buf.subarray(0, n);
          buf = buf.subarray(n);
          cur.remaining -= n;
          await cur.consume(part);
          if (cur.remaining > 0) break;
        }
        if (buf.length < cur.pad) break;
        buf = buf.subarray(cur.pad);
        const finished: Current = cur;
        cur = null;
        await finished.done();
        continue;
      }

      if (buf.length < BLOCK) break;
      const h = buf.subarray(0, BLOCK);
      buf = buf.subarray(BLOCK);
      if (h.every((b) => b === 0)) continue; // 終端ブロック

      const size = readOctal(h, 124, 12);
      const type = String.fromCharCode(h[156] || 0x30);
      const mtime = new Date(readOctal(h, 136, 12) * 1000);
      const prefix = readString(h, 345, 155);
      const baseName = readString(h, 0, 100);
      const pad = size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK);

      if (type === "x") {
        cur = {
          remaining: size,
          pad,
          ...collect((d) => {
            const p = parsePax(d).path;
            if (p) nextPath = p;
          }),
        };
      } else if (type === "L") {
        cur = { remaining: size, pad, ...collect((d) => void (nextPath = readString(d, 0, d.length))) };
      } else {
        const name: string = nextPath ?? (prefix ? `${prefix}/${baseName}` : baseName);
        nextPath = null;
        const sink = type === "0" || type === "\0" ? await onEntry({ name, size, mtime }) : null;
        cur = {
          remaining: size,
          pad,
          consume: (c) => (sink ? sink.write(c) : undefined),
          done: () => (sink ? sink.end() : undefined),
        };
      }
    }
  }
  if (cur) throw new Error("バックアップファイルが途中で終わっています（破損している可能性があります）");
}
