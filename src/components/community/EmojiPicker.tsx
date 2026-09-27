"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EMOJI_GROUPS } from "@/lib/community/constants";
import { Emoji } from "./Emoji";

const RECENT_KEY = "community:recentEmoji";

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 16) : [];
  } catch {
    return [];
  }
}

function pushRecent(emoji: string) {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, 16);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // 記憶できなくても選択はできる
  }
}

/** 絵文字の選択パネル（Slack と同じ構成。親要素に対して絶対配置）。外側クリック・Esc で閉じる。 */
export default function EmojiPicker({
  onSelect,
  onClose,
  className = "",
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => setRecent(readRecent()), []);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const groups = useMemo(
    () => (recent.length > 0 ? [{ label: "最近使った絵文字", emojis: recent }, ...EMOJI_GROUPS] : EMOJI_GROUPS),
    [recent],
  );
  const current = groups[Math.min(tab, groups.length - 1)];

  const pick = (e: string) => {
    pushRecent(e);
    onSelect(e);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="絵文字を選択"
      className={`z-[120] w-[320px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[8px] border border-sk-line bg-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] ${className}`}
    >
      <div className="flex gap-0.5 border-b border-sk-line px-2 pt-2" role="tablist">
        {groups.map((g, i) => (
          <button
            key={g.label}
            type="button"
            role="tab"
            aria-selected={i === tab}
            title={g.label}
            onClick={() => setTab(i)}
            className={`flex h-9 w-9 items-center justify-center rounded-t-[6px] border-b-2 ${
              i === tab ? "border-sk-link bg-sk-soft" : "border-transparent hover:bg-sk-soft"
            }`}
          >
            <Emoji emoji={g.emojis[0]} size={20} />
          </button>
        ))}
      </div>
      <p className="px-3 pt-2 pb-1 text-[13px] font-bold text-sk-text">{current.label}</p>
      <div className="grid max-h-[220px] grid-cols-8 gap-0.5 overflow-y-auto px-2 pb-2">
        {current.emojis.map((e) => (
          <button
            key={current.label + e}
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-[6px] hover:bg-[#1D9BD11A]"
            onMouseEnter={() => setHover(e)}
            onFocus={() => setHover(e)}
            onClick={() => pick(e)}
            aria-label={e}
          >
            <Emoji emoji={e} size={24} />
          </button>
        ))}
      </div>
      <div className="flex h-12 items-center gap-2 border-t border-sk-line bg-sk-soft px-3">
        {hover ? (
          <>
            <Emoji emoji={hover} size={32} />
            <span className="text-[13px] text-sk-mute">クリックで選択</span>
          </>
        ) : (
          <span className="text-[13px] text-sk-mute">絵文字を選んでください</span>
        )}
      </div>
    </div>
  );
}
