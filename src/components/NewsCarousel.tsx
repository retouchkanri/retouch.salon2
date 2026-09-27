"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { NewsItem } from "@/types/db";

/**
 * 本文（HTML）からプレーンテキストの抜粋を作る。
 * RichTextEditor で保存された本文は `<p>...</p>` のような HTML なので、
 * そのまま表示するとタグや実体参照が文字として見えてしまう。
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// 見せかけのループ用に配列を2倍にすると、件数が少ないうちは同じ記事が
// 隣り合って2回表示され「2件アップされた」ように見えてしまう。
// ある程度件数が増えて初めてループを有効にする。
const LOOP_MIN_ITEMS = 5;

export default function NewsCarousel({ items }: { items: NewsItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const shouldLoop = items.length >= LOOP_MIN_ITEMS;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !shouldLoop) return;

    let raf: number;
    let pos = 0;
    const speed = 0.5;

    const step = () => {
      if (!paused) {
        pos += speed;
        const halfWidth = el.scrollWidth / 2;
        if (pos >= halfWidth) pos -= halfWidth;
        el.scrollLeft = pos;
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [paused, shouldLoop]);

  if (items.length === 0) return null;

  const doubled = shouldLoop ? [...items, ...items] : items;

  return (
    <div
      ref={scrollRef}
      className={`flex gap-6 ${shouldLoop ? "overflow-hidden" : "overflow-x-auto"}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      {doubled.map((n, i) => (
        <Link
          href={`/news/${n.id}`}
          key={`${n.id}-${i}`}
          className="block bg-white shadow-sm rounded-xl overflow-hidden hover:shadow-lg transition-shadow group shrink-0"
          style={{ width: 320 }}
        >
          {n.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={n.image_url}
              alt={n.title}
              className="w-full h-40 object-cover"
              loading="lazy"
            />
          )}
          <div className="h-1 bg-gradient-to-r from-brand to-brand-light" />
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <time className="text-xs text-ink-mute tabular-nums">
                {new Date(n.published_at).toLocaleDateString("ja-JP", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                }).replace(/\//g, ".")}
              </time>
              <span className={`text-[10px] font-bold px-2 py-0.5 ${n.tag_color}`}>{n.tag}</span>
            </div>
            <h3 className="font-bold text-sm text-ink mb-2 group-hover:text-brand transition-colors leading-snug line-clamp-2">
              {n.title}
            </h3>
            {n.body && (
              <p className="text-xs text-ink-soft leading-relaxed line-clamp-2">
                {htmlToPlainText(n.body)}
              </p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
