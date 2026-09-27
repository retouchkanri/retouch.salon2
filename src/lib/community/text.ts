/**
 * コミュニティの純粋なヘルパー（I/O なし・テスト対象）。
 *   - 本文の書式解析（*太字* ~取り消し~ `コード` ```コードブロック``` URL・メンション）
 *   - 入力欄の @表示名 ⇔ 保存形式 <@ユーザーID> の変換
 *   - 日本時間の日付・時刻表示、メッセージ一覧の並び、通知判定
 *
 * 表示は React のテキストノードとして描画するため HTML は解釈しない（XSS 対策）。
 */
import type { NotifyLevel } from "./constants";
import type { ChannelRow, Message } from "./types";

// ---------------------------------------------------------------------------
// 本文の書式
// ---------------------------------------------------------------------------

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "strike"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string }
  | { type: "mention"; userId: string }
  | { type: "channel" }
  | { type: "br" };

export type Block =
  | { type: "code"; text: string }
  | { type: "para"; inlines: Inline[] }
  | { type: "quote"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const INLINE_RE = new RegExp(
  [
    "(`[^`\\n]+`)", // 1 inline code
    `(<@(${UUID})>)`, // 2,3 mention
    "(<!channel>)", // 4 @channel
    "(https?:\\/\\/[^\\s<>\"'`]+)", // 5 url
    "(\\*[^*\\n]+\\*)", // 6 bold
    "(~[^~\\n]+~)", // 7 strike
    "(_[^_\\n]+_)", // 8 italic
  ].join("|"),
  "gi",
);

const TRAILING_URL_PUNCT = /[.,;:!?)\]}'"。、，．！？）」』】]+$/;
const WORD_EDGE = /[\s.,;:!?)(\]\[「」『』（）。、！？]/;

function isEdge(ch: string | undefined): boolean {
  return ch === undefined || WORD_EDGE.test(ch);
}

function pushText(out: Inline[], text: string) {
  if (!text) return;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: "br" });
    if (!line) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.text += line;
    else out.push({ type: "text", text: line });
  });
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let pos = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    const start = m.index;
    const consumed = m[0].length;
    let token = m[0];
    if (m[1]) {
      pushText(out, text.slice(pos, start));
      out.push({ type: "code", text: token.slice(1, -1) });
    } else if (m[2]) {
      pushText(out, text.slice(pos, start));
      out.push({ type: "mention", userId: m[3].toLowerCase() });
    } else if (m[4]) {
      pushText(out, text.slice(pos, start));
      out.push({ type: "channel" });
    } else if (m[5]) {
      pushText(out, text.slice(pos, start));
      const trail = token.match(TRAILING_URL_PUNCT)?.[0] ?? "";
      if (trail) token = token.slice(0, token.length - trail.length);
      out.push({ type: "link", href: token, text: token });
      pushText(out, trail);
    } else if (m[6] || m[7] || m[8]) {
      // *太字* / ~取り消し~ / _斜体_ は語の区切りに挟まれている場合のみ
      // （2*3*4 や snake_case_name のような誤判定を避ける）
      const before = start > 0 ? text[start - 1] : undefined;
      const after = text[start + token.length];
      if (isEdge(before) && isEdge(after) && token.slice(1, -1).trim() !== "") {
        pushText(out, text.slice(pos, start));
        out.push({ type: m[6] ? "bold" : m[7] ? "strike" : "italic", text: token.slice(1, -1) });
      } else {
        // 先頭の1文字だけを文字として消費し、残りは再度解析する
        pushText(out, text.slice(pos, start + 1));
        pos = start + 1;
        INLINE_RE.lastIndex = pos;
        continue;
      }
    }
    pos = start + consumed;
    INLINE_RE.lastIndex = pos;
  }
  pushText(out, text.slice(pos));
  return out;
}

const QUOTE_LINE = /^[>＞] ?(.*)$/;
const BULLET_LINE = /^(?:[•・]\s*|[-*]\s+)(.+)$/;
const ORDERED_LINE = /^(\d{1,3})[.)．]\s+(.+)$/;

/** コードブロック以外の部分を、段落・引用（> ）・箇条書き（• / - ）・番号付き（1. ）に分ける。 */
function parseLines(text: string, blocks: Block[]) {
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flushPara = () => {
    const t = para.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    if (t) blocks.push({ type: "para", inlines: parseInline(t) });
    para = [];
  };
  const flushQuote = () => {
    if (quote.length > 0) blocks.push({ type: "quote", inlines: parseInline(quote.join("\n")) });
    quote = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, start: list.start, items: list.items.map(parseInline) });
    list = null;
  };

  for (const line of text.split("\n")) {
    const q = line.match(QUOTE_LINE);
    const b = q ? null : line.match(BULLET_LINE);
    const o = q || b ? null : line.match(ORDERED_LINE);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
    } else if (b || o) {
      flushPara();
      flushQuote();
      const ordered = !!o;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, start: o ? Number(o[1]) || 1 : 1, items: [] };
      }
      list.items.push((o ? o[2] : b![1]).trim());
    } else {
      flushQuote();
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushQuote();
  flushList();
}

/** 本文をコードブロック（```）・引用・箇条書き・段落に分けて解析する。 */
export function parseMessageBody(body: string): Block[] {
  const blocks: Block[] = [];
  const parts = (body ?? "").split("```");
  parts.forEach((part, i) => {
    // 奇数番目がコードブロック。閉じていない ``` は通常の文字として扱う。
    const isCode = i % 2 === 1 && i < parts.length - 1;
    if (isCode) {
      blocks.push({ type: "code", text: part.replace(/^\n/, "").replace(/\n$/, "") });
    } else {
      const text = i % 2 === 1 ? "```" + part : part;
      parseLines(text, blocks);
    }
  });
  return blocks;
}

/** 通知・検索結果用のプレーンテキスト（書式記号とトークンを取り除く）。 */
export function plainText(body: string, nameOf: (userId: string) => string, max = 120): string {
  const text = (body ?? "")
    .replace(new RegExp(`<@(${UUID})>`, "gi"), (_, id: string) => `@${nameOf(id.toLowerCase())}`)
    .replace(/<!channel>/g, "@channel")
    .replace(/```/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ---------------------------------------------------------------------------
// @メンション（入力欄）
// ---------------------------------------------------------------------------

export type KnownMention = { id: string; name: string };

const CHANNEL_WORDS = ["channel", "here", "全員"];
const MENTION_END = "(?=$|[\\s、。,.!?！？)）」』])";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 入力欄の「@表示名」を保存形式「<@ユーザーID>」に変換する。
 * 候補から選んだ（known に含まれる）名前だけを変換し、それ以外の @ はそのまま残す。
 */
export function encodeMentions(
  text: string,
  known: KnownMention[],
  allowChannel: boolean,
): { body: string; mentions: string[]; mentionChannel: boolean } {
  // 利用者が直接入力した "<@" "<!" はトークンと誤認されないよう無害化する
  let body = (text ?? "").replace(/<([@!])/g, "<​$1");
  const mentions = new Set<string>();
  let mentionChannel = false;

  const names = Array.from(
    new Map(known.filter((k) => k.name).map((k) => [k.name, k.id])).entries(),
  ).sort((a, b) => b[0].length - a[0].length);
  if (names.length > 0) {
    const re = new RegExp(`@(${names.map(([n]) => escapeRegExp(n)).join("|")})${MENTION_END}`, "g");
    const byName = new Map(names);
    body = body.replace(re, (_, name: string) => {
      const id = byName.get(name);
      if (!id) return `@${name}`;
      mentions.add(id);
      return `<@${id}>`;
    });
  }

  if (allowChannel) {
    const re = new RegExp(`@(${CHANNEL_WORDS.map(escapeRegExp).join("|")})${MENTION_END}`, "g");
    body = body.replace(re, () => {
      mentionChannel = true;
      return "<!channel>";
    });
  }

  return { body, mentions: Array.from(mentions), mentionChannel };
}

/** 保存形式を入力欄用の「@表示名」に戻す（編集時）。 */
export function decodeMentions(
  body: string,
  nameOf: (userId: string) => string,
): { text: string; known: KnownMention[] } {
  const known = new Map<string, string>();
  const text = (body ?? "")
    .replace(new RegExp(`<@(${UUID})>`, "gi"), (_, raw: string) => {
      const id = raw.toLowerCase();
      const name = nameOf(id);
      known.set(id, name);
      return `@${name}`;
    })
    .replace(/<!channel>/g, "@channel")
    .replace(/<​([@!])/g, "<$1");
  return { text, known: Array.from(known, ([id, name]) => ({ id, name })) };
}

/** キャレット直前の「@入力中の文字」を返す（候補表示用）。無ければ null。 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(/(^|[\s(（「])@([^\s@]{0,30})$/);
  if (!m) return null;
  const start = before.length - m[2].length - 1;
  return { start, query: m[2] };
}

// ---------------------------------------------------------------------------
// 日本時間の表示
// ---------------------------------------------------------------------------

const TZ = "Asia/Tokyo";
const TIME_FMT = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAY_PARTS_FMT = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

function dayParts(d: Date): { y: string; m: string; d: string; w: string } {
  const parts = Object.fromEntries(DAY_PARTS_FMT.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: parts.year, m: parts.month, d: parts.day, w: parts.weekday };
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : TIME_FMT.format(d);
}

/** 日本時間の日付キー（YYYY-M-D）。 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = dayParts(d);
  return `${p.y}-${p.m}-${p.d}`;
}

export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return "今日";
  if (key === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return "昨日";
  const p = dayParts(d);
  const n = dayParts(now);
  return p.y === n.y ? `${p.m}月${p.d}日（${p.w}）` : `${p.y}年${p.m}月${p.d}日（${p.w}）`;
}

export function formatDateTime(iso: string, now: Date = new Date()): string {
  const label = formatDayLabel(iso, now);
  return label ? `${label} ${formatTime(iso)}` : "";
}

// ---------------------------------------------------------------------------
// メッセージ一覧
// ---------------------------------------------------------------------------

function compareMessages(a: Pick<Message, "created_at" | "id">, b: Pick<Message, "created_at" | "id">): number {
  const t = a.created_at.localeCompare(b.created_at);
  return t !== 0 ? t : a.id.localeCompare(b.id);
}

/** 古い順を保ったまま追加・置き換える（Realtime と送信結果の重複もここで吸収）。 */
export function upsertMessage(list: Message[], msg: Message): Message[] {
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = msg;
    return next;
  }
  const next = list.concat(msg);
  // 通常は末尾への追加なので、並びが崩れた場合のみ並べ直す
  if (list.length > 0 && compareMessages(list[list.length - 1], msg) > 0) next.sort(compareMessages);
  return next;
}

/** 複数件をまとめて追加（古いメッセージの読み込み時）。 */
export function mergeMessages(list: Message[], more: Message[]): Message[] {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of more) map.set(m.id, m);
  return Array.from(map.values()).sort(compareMessages);
}

/** 直前と同じ人の連続投稿（5分以内・同じ日）なら名前とアイコンを省略する。 */
export function shouldGroup(prev: Message | undefined, cur: Message): boolean {
  if (!prev || prev.deleted_at || cur.deleted_at) return false;
  if (!prev.user_id || prev.user_id !== cur.user_id) return false;
  if (dayKey(prev.created_at) !== dayKey(cur.created_at)) return false;
  const gap = new Date(cur.created_at).getTime() - new Date(prev.created_at).getTime();
  return gap >= 0 && gap < 5 * 60 * 1000;
}

/** 削除済みでも返信があるものは「削除されました」として残し、それ以外は表示しない。 */
export function isVisibleMessage(m: Message): boolean {
  return !m.deleted_at || m.reply_count > 0;
}

// ---------------------------------------------------------------------------
// チャンネル・通知
// ---------------------------------------------------------------------------

/** 通知設定の既定値: DM と運営のみ投稿のチャンネルは「すべて」、その他は「メンションのみ」。 */
export function effectiveNotify(ch: Pick<ChannelRow, "notify" | "kind" | "post_policy">): NotifyLevel {
  return ch.notify ?? (ch.kind === "dm" || ch.post_policy === "staff" ? "all" : "mentions");
}

export function isMentioned(msg: Pick<Message, "mentions" | "mention_channel">, userId: string): boolean {
  return msg.mention_channel || (msg.mentions ?? []).includes(userId);
}

/** 新着メッセージを通知すべきか（自分の投稿・スレッド返信・ミュートは対象外）。 */
export function shouldNotify(
  ch: Pick<ChannelRow, "notify" | "kind" | "post_policy" | "joined">,
  msg: Pick<Message, "user_id" | "parent_id" | "mentions" | "mention_channel" | "deleted_at">,
  userId: string,
): boolean {
  if (!msg.user_id || msg.user_id === userId || msg.parent_id || msg.deleted_at) return false;
  if (!ch.joined) return false;
  const level = effectiveNotify(ch);
  if (level === "none") return false;
  if (level === "all") return true;
  return isMentioned(msg, userId);
}

/**
 * サイドバーのバッジ数。community_unread_summary（ヘッダーのバッジ）と同じ規則:
 * 通知「すべて」→ 未読数 / 「メンションのみ」→ メンション数 / ミュート → 0。
 */
export function badgeCount(ch: Pick<ChannelRow, "notify" | "kind" | "post_policy" | "unread_count" | "mention_count">): number {
  const level = effectiveNotify(ch);
  if (level === "all") return ch.unread_count;
  if (level === "mentions") return ch.mention_count;
  return 0;
}

/**
 * 鍵アイコンで表示するチャンネルか。非公開チャンネルに加え、対象者を限定したチャンネル
 * （会員種別・支援者・運営のみ）も、対象外の人には見えないため非公開として扱う。
 */
export function isPrivateChannel(ch: Pick<ChannelRow, "kind" | "visibility" | "audience">): boolean {
  return ch.kind === "channel" && (ch.visibility === "private" || ch.audience !== "all");
}

export function sortChannels(list: ChannelRow[]): ChannelRow[] {
  return list.slice().sort((a, b) => a.sort_order - b.sort_order || (a.name ?? "").localeCompare(b.name ?? "", "ja"));
}

export function sortDms(list: ChannelRow[]): ChannelRow[] {
  return list.slice().sort((a, b) => {
    const at = a.last_message_at ?? a.created_at;
    const bt = b.last_message_at ?? b.created_at;
    return bt.localeCompare(at);
  });
}

// ---------------------------------------------------------------------------
// ファイル
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Storage のパス: <channel>/<user>/<ランダム><拡張子>。
 * オブジェクト名に日本語などを含めない（元のファイル名はメッセージ側に保存する）。
 */
export function attachmentPath(channelId: string, userId: string, fileName: string, randomId: string): string {
  const ext = (fileName.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? "").toLowerCase();
  const safeId = randomId.replace(/[^A-Za-z0-9-]/g, "");
  return `${channelId}/${userId}/${safeId}${ext}`;
}

export function isImageType(type: string | null | undefined): boolean {
  return !!type && /^image\/(jpeg|png|gif|webp)$/.test(type);
}

// ---------------------------------------------------------------------------
// チャンネル名（community__normalize_channel_name / community__check_channel_name と同じ規則）
// ---------------------------------------------------------------------------

export const CHANNEL_NAME_LIMIT = 60;
const EDGE_SPACE = /^[ \t\r\n　]+|[ \t\r\n　]+$/g;
const CHANNEL_NAME_SYMBOLS = /[\][<>@#&"'`\\/|*?:;,.!(){}=+~^%$]/;
const RESERVED_CHANNEL_WORDS = /(運営|スタッフ|事務局|管理者|retouch|リタッチ|admin|staff|official|公式|お知らせ)/i;

/** Slack と同じく、前後の空白と先頭の # を除き、空白を - に、英字を小文字にする。 */
export function normalizeChannelName(input: string): string {
  return (input ?? "")
    .replace(EDGE_SPACE, "")
    .replace(/^[#＃]+/, "")
    .replace(EDGE_SPACE, "")
    .replace(/[\s　]+/g, "-")
    .toLowerCase();
}

/** 会員が付けるチャンネル名の問題点（問題が無ければ null）。運営は予約語の制限なし。 */
export function channelNameProblem(input: string, staff: boolean): string | null {
  const name = normalizeChannelName(input);
  if (name.length < 1) return "チャンネル名を入力してください。";
  if (name.length > CHANNEL_NAME_LIMIT) return `チャンネル名は${CHANNEL_NAME_LIMIT}文字以内で入力してください。`;
  if (CHANNEL_NAME_SYMBOLS.test(name)) return "チャンネル名に記号は使えません（ハイフン - とアンダースコア _ は使えます）。";
  if (!staff && RESERVED_CHANNEL_WORDS.test(name)) return "「運営」「公式」「お知らせ」などを含むチャンネル名は使用できません。";
  return null;
}

// ---------------------------------------------------------------------------
// 入力欄の書式ボタン
// ---------------------------------------------------------------------------

export type FormatKind = "bold" | "italic" | "strike" | "code" | "codeblock" | "quote" | "bullet" | "ordered" | "link";

/**
 * 選択範囲に書式を付ける。戻り値は新しい本文と、選択し直す範囲。
 * 行単位の書式（引用・箇条書き・番号）は選択範囲を含む各行の先頭に記号を付ける。
 */
export function applyFormat(
  text: string,
  start: number,
  end: number,
  kind: FormatKind,
  url?: string,
): { text: string; start: number; end: number } {
  const s = Math.max(0, Math.min(start, end));
  const e = Math.min(text.length, Math.max(start, end));
  const selected = text.slice(s, e);
  const wrap = (open: string, close: string, placeholder: string) => {
    const inner = selected || placeholder;
    const next = text.slice(0, s) + open + inner + close + text.slice(e);
    return { text: next, start: s + open.length, end: s + open.length + inner.length };
  };
  switch (kind) {
    case "bold":
      return wrap("*", "*", "太字");
    case "italic":
      return wrap("_", "_", "斜体");
    case "strike":
      return wrap("~", "~", "取り消し");
    case "code":
      return wrap("`", "`", "コード");
    case "codeblock":
      return wrap("```\n", "\n```", "コード");
    case "link": {
      const href = (url ?? "").trim();
      if (!href) return { text, start: s, end: e };
      const label = selected.trim();
      const insert = label && label !== href ? `${label} ${href}` : href;
      const next = text.slice(0, s) + insert + text.slice(e);
      return { text: next, start: s + insert.length, end: s + insert.length };
    }
    default: {
      const lineStart = text.lastIndexOf("\n", s - 1) + 1;
      const nl = text.indexOf("\n", e);
      const lineEnd = nl === -1 ? text.length : nl;
      const lines = text.slice(lineStart, lineEnd).split("\n");
      const prefixed = lines.map((l, i) => {
        const bare = l.replace(/^(?:[>＞] ?|[•・]\s*|[-*]\s+|\d{1,3}[.)．]\s+)/, "");
        if (kind === "quote") return `> ${bare}`;
        if (kind === "bullet") return `• ${bare}`;
        return `${i + 1}. ${bare}`;
      });
      const block = prefixed.join("\n");
      const next = text.slice(0, lineStart) + block + text.slice(lineEnd);
      return { text: next, start: lineStart + block.length, end: lineStart + block.length };
    }
  }
}
