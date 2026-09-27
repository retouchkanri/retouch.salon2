/**
 * 絵文字の画像（Fluent Emoji 3D・MIT ライセンス © Microsoft）。
 * /public/noprecache/emoji/<コードポイント>.png に 64px で置いている（noprecache 配下なので
 * PWA のプリキャッシュには含まれず、表示したものだけが読み込まれる）。
 *
 * 画像を追加するときは github.com/microsoft/fluentui-emoji の assets/<名前>/3D/*.png を 64×64 にして
 * 上のフォルダに置き、EMOJI_IMAGE_CODES に追記する（tests/emojiAssets.test.ts が確認する）。
 * 画像の無い絵文字は OS の絵文字フォントで表示する。
 */
export const EMOJI_BASE = "/noprecache/emoji";

export const EMOJI_IMAGE_CODES: readonly string[] = [
  "1f308",
  "1f319",
  "1f331",
  "1f338",
  "1f33b",
  "1f33e",
  "1f340",
  "1f34e",
  "1f370",
  "1f381",
  "1f389",
  "1f3c6",
  "1f3c7",
  "1f40e",
  "1f431",
  "1f434",
  "1f436",
  "1f440",
  "1f449",
  "1f44b",
  "1f44c",
  "1f44d",
  "1f44f",
  "1f451",
  "1f481",
  "1f490",
  "1f499",
  "1f49a",
  "1f49b",
  "1f49c",
  "1f49d",
  "1f4a1",
  "1f4aa",
  "1f4ac",
  "1f4af",
  "1f4b3",
  "1f4be",
  "1f4c5",
  "1f4c7",
  "1f4ca",
  "1f4cc",
  "1f4d6",
  "1f4dd",
  "1f4e3",
  "1f4f0",
  "1f4f7",
  "1f50d",
  "1f510",
  "1f514",
  "1f525",
  "1f5c2",
  "1f5d3",
  "1f600",
  "1f601",
  "1f602",
  "1f603",
  "1f604",
  "1f605",
  "1f606",
  "1f609",
  "1f60a",
  "1f60b",
  "1f60c",
  "1f60d",
  "1f60e",
  "1f622",
  "1f624",
  "1f62d",
  "1f62e",
  "1f631",
  "1f634",
  "1f642",
  "1f645",
  "1f646",
  "1f646-200d-2640",
  "1f647",
  "1f64c",
  "1f64f",
  "1f680",
  "1f6e1",
  "1f90d",
  "1f914",
  "1f916",
  "1f917",
  "1f91d",
  "1f923",
  "1f929",
  "1f955",
  "1f970",
  "1f97a",
  "1f984",
  "1f9e1",
  "1faaa",
  "2600",
  "2615",
  "261d",
  "2705",
  "270c",
  "2728",
  "274c",
  "2753",
  "2757",
  "2764",
  "2b50",
  "2b55",
];

const AVAILABLE = new Set(EMOJI_IMAGE_CODES);

/** "🗓️" → "1f5d3"（異体字セレクタ FE0F は除き、ZWJ 連結は "-" で残す）。 */
export function emojiCode(emoji: string): string {
  return Array.from(emoji)
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((hex) => hex !== "fe0f")
    .join("-");
}

export function emojiSrc(emoji: string): string {
  return `${EMOJI_BASE}/${emojiCode(emoji)}.png`;
}

export function hasEmojiImage(emoji: string): boolean {
  return AVAILABLE.has(emojiCode(emoji));
}

/** 絵文字1文字分（肌の色・ZWJ 連結・国旗を含む）に一致する。 */
export const EMOJI_RE =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])*)*|[\u{1F1E6}-\u{1F1FF}]{2})/gu;

export type EmojiPart = { type: "text"; text: string } | { type: "emoji"; text: string };

/** 文字列を絵文字とそれ以外に分ける。 */
export function splitEmoji(text: string): EmojiPart[] {
  const out: EmojiPart[] = [];
  let pos = 0;
  EMOJI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOJI_RE.exec(text)) !== null) {
    if (m.index > pos) out.push({ type: "text", text: text.slice(pos, m.index) });
    out.push({ type: "emoji", text: m[0] });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push({ type: "text", text: text.slice(pos) });
  return out;
}

/** 本文が絵文字だけ（空白を除いて1〜23個）なら、Slack と同じく大きく表示する。 */
export function isJumboEmoji(text: string): boolean {
  const trimmed = (text ?? "").replace(/\s+/g, "");
  if (!trimmed) return false;
  const parts = splitEmoji(trimmed);
  return parts.length <= 23 && parts.every((p) => p.type === "emoji");
}
