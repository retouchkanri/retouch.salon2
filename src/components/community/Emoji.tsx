"use client";

import { Fragment, memo } from "react";
import { emojiSrc, hasEmojiImage, splitEmoji } from "@/lib/emoji";

/** 絵文字1つ（画像があれば Fluent 3D の画像、無ければ OS の絵文字）。 */
function EmojiInner({ emoji, size = 22, className = "" }: { emoji: string; size?: number; className?: string }) {
  if (!hasEmojiImage(emoji)) {
    return (
      <span
        className={`inline-block text-center leading-none align-[-0.2em] ${className}`}
        style={{ fontSize: Math.round(size * 0.86), width: size }}
      >
        {emoji}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={emojiSrc(emoji)}
      alt={emoji}
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      decoding="async"
      className={`inline-block align-[-0.28em] select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export const Emoji = memo(EmojiInner);

/** 文字列中の絵文字を画像にして表示する。 */
export function EmojiText({ text, size = 22 }: { text: string; size?: number }) {
  const parts = splitEmoji(text);
  if (parts.length === 1 && parts[0].type === "text") return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.type === "emoji" ? <Emoji key={i} emoji={p.text} size={size} /> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </>
  );
}
