"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useState } from "react";

const PRESET_COLORS: { label: string; value: string }[] = [
  { label: "黒（デフォルト）", value: "#1f2937" },
  { label: "グリーン", value: "#2d6a4f" },
  { label: "赤", value: "#b91c1c" },
  { label: "青", value: "#1d4ed8" },
  { label: "オレンジ", value: "#b45309" },
  { label: "グレー", value: "#6b7280" },
];

function Btn({
  onClick,
  active,
  title,
  children,
  disabled,
}: {
  onClick: () => void;
  active?: boolean;
  title?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={[
        "px-2 py-1 rounded text-sm leading-none transition-colors select-none",
        active
          ? "bg-brand-50 border border-brand text-brand-dark font-bold"
          : "border border-transparent text-ink-soft hover:bg-surface-soft hover:text-ink",
        disabled ? "opacity-30 cursor-default" : "cursor-pointer",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="w-px h-5 bg-surface-line mx-0.5 shrink-0" />;
}

/** 既存の平文テキスト（<タグなし）を Tiptap に渡せる HTML に変換する */
function normalizeContent(val: string): string {
  if (!val) return "";
  if (val.trimStart().startsWith("<")) return val;
  return val
    .split(/\r?\n/)
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</p>`)
    .join("");
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "本文を入力…",
  minHeight = 180,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showColor, setShowColor] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExt,
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      LinkExt.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-brand underline" },
      }),
    ],
    content: normalizeContent(value),
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
    editorProps: {
      attributes: {
        "data-placeholder": placeholder,
        class: "ProseMirror",
      },
    },
  });

  /* 外部から value が変わったとき（例: フォームリセット）に同期する */
  useEffect(() => {
    if (!editor) return;
    const normalized = normalizeContent(value);
    if (normalized !== editor.getHTML()) {
      editor.commands.setContent(normalized || "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!editor) return null;

  const applyLink = () => {
    if (!linkUrl.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = /^https?:\/\//i.test(linkUrl) ? linkUrl : `https://${linkUrl}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkUrl("");
    setShowLink(false);
  };

  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) ?? "";

  return (
    <div className="border border-surface-line rounded-xl overflow-hidden focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 transition-colors bg-white">

      {/* ── ツールバー ── */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-surface-line bg-surface-soft">

        {/* 段落スタイル */}
        <Btn onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive("paragraph")} title="段落">本文</Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="見出し1">H1</Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="見出し2">H2</Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="見出し3">H3</Btn>

        <Sep />

        {/* テキストスタイル */}
        <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="太字"><b>B</b></Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="斜体"><i>I</i></Btn>
        <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="下線"><u>U</u></Btn>
        <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="取り消し線"><s>S</s></Btn>

        <Sep />

        {/* 文字色 */}
        <div className="relative">
          <Btn
            onClick={() => { setShowColor((v) => !v); setShowLink(false); }}
            title="文字色"
            active={showColor}
          >
            <span className="relative">
              <span>A</span>
              <span
                className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full"
                style={{ background: currentColor || "#1f2937" }}
              />
            </span>
          </Btn>
          {showColor && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-surface-line rounded-lg shadow-lg p-2 min-w-[140px] space-y-0.5">
              <button
                type="button"
                className="w-full flex items-center gap-2 text-xs px-2 py-1 hover:bg-surface-soft rounded text-left"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setShowColor(false); }}
              >
                <span className="w-4 h-4 rounded-full border border-surface-line bg-[#1f2937]" />
                デフォルト
              </button>
              {PRESET_COLORS.slice(1).map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className="w-full flex items-center gap-2 text-xs px-2 py-1 hover:bg-surface-soft rounded text-left"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c.value).run(); setShowColor(false); }}
                >
                  <span className="w-4 h-4 rounded-full border border-surface-line shrink-0" style={{ background: c.value }} />
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Sep />

        {/* リスト */}
        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="箇条書き">• 一覧</Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="番号リスト">1. 一覧</Btn>

        <Sep />

        {/* 整列 */}
        <Btn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="左揃え">≡←</Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="中央揃え">≡↔</Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="右揃え">≡→</Btn>

        <Sep />

        {/* リンク */}
        <Btn
          onClick={() => {
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run();
            } else {
              const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
              setLinkUrl(existing);
              setShowLink((v) => !v);
              setShowColor(false);
            }
          }}
          active={editor.isActive("link") || showLink}
          title={editor.isActive("link") ? "リンクを解除" : "リンクを追加"}
        >🔗</Btn>

        <Sep />

        {/* Undo/Redo */}
        <Btn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="元に戻す">↩</Btn>
        <Btn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="やり直す">↪</Btn>
      </div>

      {/* ── リンク入力バー ── */}
      {showLink && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-line bg-brand-50/40">
          <span className="text-xs text-ink-soft shrink-0">URL:</span>
          <input
            type="url"
            className="input flex-1 !py-1 !text-sm"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") setShowLink(false); }}
            autoFocus
          />
          <button type="button" onMouseDown={(e) => { e.preventDefault(); applyLink(); }} className="btn-primary !py-1 !px-3 !text-sm shrink-0">設定</button>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); setShowLink(false); }} className="btn-ghost !py-1 !px-2 !text-sm shrink-0">✕</button>
        </div>
      )}

      {/* ── エディタ本体 ── */}
      <div
        className="rich-text cursor-text"
        style={{ minHeight }}
        onClick={() => editor.commands.focus()}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
