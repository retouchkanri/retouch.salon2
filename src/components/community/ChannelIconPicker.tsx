"use client";

import { useEffect, useRef, useState } from "react";
import { Emoji } from "./Emoji";
import { Icon } from "./icons";
import { ChannelIconView } from "./Sidebar";

/** 作成画面などで選んだ（まだ保存していない）アイコン */
export type IconDraft = { kind: "emoji"; emoji: string } | { kind: "file"; file: File; preview: string } | null;

/** よく使うチャンネルのアイコン */
export const ICON_EMOJIS = [
  "💬", "📣", "👋", "❓", "📷", "🎉", "🏡", "🌿",
  "🐴", "🐎", "🥕", "🌈", "🏆", "👑", "💐", "⭐",
  "📅", "📚", "🎁", "❤️", "🤝", "🌸", "☀️", "🛡️",
];

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** 下書きを保存用の値にする */
export function draftToInput(d: IconDraft): { file: File } | { emoji: string } | null {
  if (!d) return null;
  return d.kind === "file" ? { file: d.file } : { emoji: d.emoji };
}

/**
 * チャンネルのアイコンを選ぶ（画像のアップロード または 絵文字）。
 * value: 表示中のアイコン（保存済みの値 = 文字列 / 下書き = IconDraft）。
 */
export default function ChannelIconPicker({
  value,
  onPick,
  onClear,
  busy = false,
  placeholder,
}: {
  value: string | IconDraft;
  onPick: (d: Exclude<IconDraft, null>) => void;
  onClear?: () => void;
  busy?: boolean;
  /** アイコンが無いときに出すもの（# など） */
  placeholder: React.ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown =
    typeof value === "string" ? value : value?.kind === "file" ? value.preview : value?.kind === "emoji" ? value.emoji : null;
  const selectedEmoji = typeof value === "string" ? value : value?.kind === "emoji" ? value.emoji : null;

  const onFile = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!ALLOWED.includes(f.type)) return setError("JPEG・PNG・WEBP・GIF の画像を選んでください。");
    if (f.size > MAX_BYTES) return setError("画像は2MB以内にしてください。");
    onPick({ kind: "file", file: f, preview: URL.createObjectURL(f) });
  };

  return (
    <div className={busy ? "pointer-events-none opacity-60" : ""}>
      <div className="flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-[#E2E9E4] bg-[#E3F0E8] text-[#2D6A4F]">
          {shown ? <ChannelIconView icon={shown} size={shown.startsWith("blob:") || shown.startsWith("/") ? 64 : 36} /> : placeholder}
        </span>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ALLOWED.join(",")}
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-9 items-center gap-1.5 rounded-full border border-[#DCE4DE] bg-white px-4 text-[13px] font-bold text-sk-text transition-colors hover:border-[#C7D8CD] hover:bg-sk-soft"
          >
            <Icon name="paperclip" className="w-4 h-4" />
            画像をアップロード
          </button>
          {shown && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex h-9 items-center rounded-full px-3 text-[13px] font-bold text-sk-mute transition-colors hover:bg-sk-soft hover:text-[#D2475E]"
            >
              アイコンを外す
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-[13px] text-[#D2475E]">{error}</p>}
      <p className="mt-3 mb-1.5 text-[12px] font-bold text-sk-mute">または絵文字から選ぶ</p>
      <div className="grid grid-cols-8 gap-1">
        {ICON_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => {
              setError(null);
              onPick({ kind: "emoji", emoji: e });
            }}
            className={`flex h-9 items-center justify-center rounded-[10px] transition-all hover:scale-110 hover:bg-[#E3F0E8] ${
              selectedEmoji === e ? "bg-[#E3F0E8] ring-2 ring-[#2D6A4F]" : ""
            }`}
            aria-label={`${e} をアイコンにする`}
            aria-pressed={selectedEmoji === e}
          >
            <Emoji emoji={e} size={22} />
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-sk-mute">画像は正方形がおすすめです（2MBまで）。</p>
    </div>
  );
}

/** 保存済みのアイコンをその場で変更する（チャンネルの詳細画面用） */
export function ChannelIconEditor({
  icon,
  placeholder,
  onSave,
}: {
  icon: string | null | undefined;
  placeholder: React.ReactNode;
  onSave: (input: { file: File } | { emoji: string } | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<IconDraft>(null);
  const [busy, setBusy] = useState(false);
  // 画像のプレビュー用 URL を片付ける
  useEffect(() => () => {
    if (draft?.kind === "file") URL.revokeObjectURL(draft.preview);
  }, [draft]);

  const apply = async (d: IconDraft) => {
    setBusy(true);
    setDraft(d);
    const ok = await onSave(draftToInput(d));
    setBusy(false);
    setDraft(null);
    return ok;
  };

  return (
    <ChannelIconPicker
      value={draft ?? icon ?? null}
      busy={busy}
      placeholder={placeholder}
      onPick={(d) => void apply(d)}
      onClear={icon ? () => void apply(null) : undefined}
    />
  );
}
