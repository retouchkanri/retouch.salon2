"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/community/api";
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_COUNT, MESSAGE_MAX_LENGTH } from "@/lib/community/constants";
import {
  activeMentionQuery,
  applyFormat,
  formatBytes,
  isImageType,
  type FormatKind,
  type KnownMention,
} from "@/lib/community/text";
import type { UserInfo } from "@/lib/community/types";
import Avatar from "./Avatar";
import EmojiPicker from "./EmojiPicker";
import { Icon, type IconName } from "./icons";
import { useActions, useCS } from "./store";

type Candidate = { id: string; name: string; isStaff: boolean; special?: boolean };
type Pending = { file: File; preview: string | null };

/** Web Speech API（ブラウザにより webkit 接頭辞あり）。 */
type SpeechRecResult = { isFinal: boolean; 0?: { transcript: string } };
type SpeechRecEvent = { resultIndex: number; results: ArrayLike<SpeechRecResult> };
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecEvent) => void) | null;
};
type SpeechRecCtor = new () => SpeechRec;

function getSpeechRecognitionCtor(): SpeechRecCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const FORMAT_BUTTONS: { kind: FormatKind; icon: IconName; label: string; sep?: boolean }[] = [
  { kind: "bold", icon: "bold", label: "太字" },
  { kind: "italic", icon: "italic", label: "斜体" },
  { kind: "strike", icon: "strike", label: "取り消し線" },
  { kind: "link", icon: "link", label: "リンク", sep: true },
  { kind: "ordered", icon: "listOrdered", label: "番号付きリスト", sep: true },
  { kind: "bullet", icon: "listBullet", label: "箇条書き" },
  { kind: "quote", icon: "quote", label: "引用", sep: true },
  { kind: "code", icon: "code", label: "コード", sep: true },
  { kind: "codeblock", icon: "codeBlock", label: "コードブロック" },
];

function ToolbarButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-[4px] ${
        active ? "bg-[#1D1C1D1A] text-sk-text" : "text-[#1D1C1DB3] hover:bg-[#1D1C1D0D] hover:text-sk-text"
      } disabled:opacity-40`}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} className="w-[18px] h-[18px]" />
    </button>
  );
}

/** メッセージ入力欄（Slack と同じ構成: 書式バー・@メンション・絵文字・添付・音声入力）。 */
export default function Composer({
  channelId,
  parentId = null,
  placeholder,
}: {
  channelId: string;
  parentId?: string | null;
  placeholder: string;
}) {
  const actions = useActions();
  const isStaff = useCS((s) => s.me.isStaff);
  const chKind = useCS((s) => s.channels.find((c) => c.id === channelId)?.kind);
  const draftKey = parentId ? `t:${parentId}` : `c:${channelId}`;
  const [text, setText] = useState("");
  const [known, setKnown] = useState<KnownMention[]>([]);
  const [files, setFiles] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showFormat, setShowFormat] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [popup, setPopup] = useState<{ start: number; items: Candidate[]; index: number } | null>(null);
  const [touch, setTouch] = useState(false);
  const [listening, setListening] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    setTouch(coarse);
    if (coarse) setShowFormat(false);
    try {
      if (window.localStorage.getItem("community:formatBar") === "0") setShowFormat(false);
    } catch {
      // 既定のまま
    }
  }, []);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    },
    [],
  );

  // 下書きの復元（チャンネル・スレッドごと）
  useEffect(() => {
    const d = actions.drafts[draftKey];
    setText(d?.text ?? "");
    setKnown(d?.known ?? []);
    setPopup(null);
    setFiles((prev) => {
      prev.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      return [];
    });
    // PC ではチャンネルを開いたらすぐ入力できるようにする
    if (!window.matchMedia("(pointer: coarse)").matches) requestAnimationFrame(() => ref.current?.focus());
  }, [draftKey, actions]);

  useEffect(() => {
    actions.drafts[draftKey] = { text, known };
  }, [text, known, draftKey, actions]);

  useEffect(
    () => () => {
      filesRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    },
    [],
  );

  // 入力欄の高さを内容に合わせる
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list);
      if (incoming.length === 0) return;
      const accepted: Pending[] = [];
      for (const f of incoming) {
        const problem = api.validateAttachment(f);
        if (problem) {
          actions.pushToast({ kind: "error", title: problem });
          continue;
        }
        accepted.push({ file: f, preview: isImageType(f.type) ? URL.createObjectURL(f) : null });
      }
      setFiles((prev) => {
        const next = [...prev, ...accepted];
        if (next.length > ATTACHMENT_MAX_COUNT) {
          actions.pushToast({ kind: "error", title: `添付ファイルは1回に${ATTACHMENT_MAX_COUNT}個までです。` });
          next.slice(ATTACHMENT_MAX_COUNT).forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
          return next.slice(0, ATTACHMENT_MAX_COUNT);
        }
        return next;
      });
    },
    [actions],
  );

  const removeFile = (i: number) => {
    setFiles((prev) => {
      const target = prev[i];
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((_, j) => j !== i);
    });
  };

  // ---------------------------------------------------------------- @mention
  const updateMentionPopup = useCallback(
    (value: string, caret: number) => {
      const q = activeMentionQuery(value, caret);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (!q) {
        setPopup(null);
        return;
      }
      const seq = ++searchSeq.current;
      searchTimer.current = setTimeout(async () => {
        let rows: UserInfo[] = [];
        try {
          rows = await api.mentionCandidates(actions.db, channelId, q.query);
        } catch {
          rows = [];
        }
        if (seq !== searchSeq.current) return;
        actions.mergeUsers(rows.filter((r) => r.display_name));
        const items: Candidate[] = rows
          .filter((r) => r.display_name)
          .map((r) => ({ id: r.user_id, name: r.display_name as string, isStaff: r.is_staff }));
        if (isStaff && chKind === "channel" && "channel".startsWith(q.query.toLowerCase())) {
          items.unshift({ id: "channel", name: "channel", isStaff: false, special: true });
        }
        setPopup(items.length > 0 ? { start: q.start, items, index: 0 } : null);
      }, 100);
    },
    [actions, channelId, isStaff, chKind],
  );

  const pickCandidate = (c: Candidate) => {
    const el = ref.current;
    if (!el || !popup) return;
    const caret = el.selectionStart ?? text.length;
    const insert = `@${c.name} `;
    const next = text.slice(0, popup.start) + insert + text.slice(caret);
    setText(next);
    if (!c.special) setKnown((prev) => [...prev.filter((k) => k.id !== c.id), { id: c.id, name: c.name }]);
    setPopup(null);
    const pos = popup.start + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const insertAtCaret = (s: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + s.length;
      el.setSelectionRange(pos, pos);
      if (s === "@") updateMentionPopup(next, pos);
    });
  };

  const format = (kind: FormatKind) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    let url: string | undefined;
    if (kind === "link") {
      url = window.prompt("リンク先の URL を入力してください", "https://") ?? undefined;
      if (!url || !/^https?:\/\/\S+$/.test(url.trim())) return;
    }
    const r = applyFormat(text, start, end, kind, url);
    setText(r.text);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  };

  const toggleVoice = () => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      actions.pushToast({ kind: "error", title: "このブラウザでは音声入力に対応していません。" });
      return;
    }
    if (listening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      return;
    }
    const recognition = new SR();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    recognition.onstart = () => setListening(true);
    recognition.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0]?.transcript ?? "";
      }
      if (!finalText) return;
      setText((prev) => {
        const sep = prev && !/\s$/.test(prev) ? " " : "";
        return prev + sep + finalText.trim();
      });
      actions.notifyTyping(channelId);
    };
    try {
      recognition.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
      actions.pushToast({ kind: "error", title: "音声入力を開始できませんでした。" });
    }
  };

  // ---------------------------------------------------------------- submit
  const submit = async () => {
    if (sending) return;
    if (!text.trim() && files.length === 0) return;
    const snapshot = { text, known, files: files.map((f) => f.file) };
    setSending(true);
    // 入力欄はすぐ空にして体感速度を上げる（失敗時は本文を戻す）
    setText("");
    setKnown([]);
    setFiles([]);
    setPopup(null);
    delete actions.drafts[draftKey];
    files.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    const ok = await actions.send({
      channelId,
      text: snapshot.text,
      known: snapshot.known,
      files: snapshot.files,
      parentId,
    });
    setSending(false);
    if (!ok) {
      setText(snapshot.text);
      setKnown(snapshot.known);
    }
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 日本語入力の変換確定の Enter では送信しない
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (popup && popup.items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPopup({ ...popup, index: (popup.index + 1) % popup.items.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPopup({ ...popup, index: (popup.index - 1 + popup.items.length) % popup.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickCandidate(popup.items[popup.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPopup(null);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const map: Record<string, FormatKind> = { b: "bold", i: "italic" };
      if (map[k]) {
        e.preventDefault();
        format(map[k]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !touch) {
      e.preventDefault();
      void submit();
    }
  };

  const tooLong = text.length > MESSAGE_MAX_LENGTH;
  const canSend = !sending && !tooLong && (text.trim().length > 0 || files.length > 0);

  return (
    <div className={parentId ? "px-4 pb-2" : "px-5 pb-1"}>
      <div
        className={`relative rounded-[8px] border bg-white transition-shadow ${
          dragOver
            ? "border-[#1D9BD1] shadow-[0_0_0_4px_rgba(29,155,209,0.3)]"
            : focused
              ? "border-[#1D1C1D80] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
              : "border-[#1D1C1D4D]"
        }`}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files.length > 0) {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }
          setDragOver(false);
        }}
      >
        {popup && popup.items.length > 0 && (
          <ul
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-[30] mb-1 max-h-64 overflow-y-auto rounded-[8px] border border-sk-line bg-white py-2 shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
          >
            <li className="px-4 pb-1 text-[13px] font-bold text-sk-mute">メンバー</li>
            {popup.items.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === popup.index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickCandidate(c);
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-[15px] ${
                    i === popup.index ? "bg-sk-active text-white" : "text-sk-text hover:bg-sk-soft"
                  }`}
                >
                  {c.special ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[#1D1C1D14]">
                      <Icon name="at" className="w-4 h-4" />
                    </span>
                  ) : (
                    <Avatar userId={c.id} size={24} />
                  )}
                  <span className="font-bold truncate">{c.special ? "@channel" : c.name}</span>
                  {c.special && (
                    <span className={`text-[13px] ${i === popup.index ? "text-white/80" : "text-sk-mute"}`}>
                      このチャンネルの全員に通知
                    </span>
                  )}
                  {c.isStaff && (
                    <span className={`text-[12px] ${i === popup.index ? "text-white/80" : "text-sk-mute"}`}>運営</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {showFormat && (
          <div className="flex items-center gap-0.5 rounded-t-[8px] bg-[#F8F8F8] px-1.5 py-1">
            {FORMAT_BUTTONS.map((b) => (
              <span key={b.kind} className="flex items-center">
                {b.sep && <span className="mx-1 h-5 w-px bg-[#1D1C1D21]" aria-hidden />}
                <ToolbarButton icon={b.icon} label={b.label} onClick={() => format(b.kind)} disabled={sending} />
              </span>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {files.map((p, i) => (
              <div
                key={i}
                className="group/file relative flex max-w-[240px] items-center gap-2 rounded-[8px] border border-[#1D1C1D21] bg-white p-1.5 pr-3"
              >
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt="" className="h-10 w-10 rounded-[6px] object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[#1D9BD1] text-white">
                    <Icon name="file" className="w-5 h-5" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold">{p.file.name}</span>
                  <span className="block text-[12px] text-sk-mute">{formatBytes(p.file.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-[999px] bg-sk-text text-white opacity-0 group-hover/file:opacity-100 focus:opacity-100"
                  aria-label={`${p.file.name} を取り除く`}
                >
                  <Icon name="close" className="w-3 h-3" strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            actions.notifyTyping(channelId);
            updateMentionPopup(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onClick={(e) => updateMentionPopup(text, e.currentTarget.selectionStart ?? text.length)}
          onBlur={() => {
            setFocused(false);
            setTimeout(() => setPopup(null), 150);
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length > 0) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          className="block max-h-[240px] min-h-[22px] w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-[1.46668] text-sk-text outline-none placeholder:text-[#1D1C1D80]"
          aria-label="メッセージ"
        />

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-7 w-7 items-center justify-center rounded-[999px] bg-[#1D1C1D14] text-[#1D1C1DB3] hover:bg-[#1D1C1D26] hover:text-sk-text"
            aria-label="ファイルを添付"
            title="ファイルを添付（画像・PDF など 10MB まで）"
          >
            <Icon name="plus" className="w-4 h-4" strokeWidth={2.5} />
          </button>
          <ToolbarButton
            icon="format"
            label={showFormat ? "書式を非表示" : "書式を表示"}
            active={showFormat}
            onClick={() =>
              setShowFormat((v) => {
                try {
                  window.localStorage.setItem("community:formatBar", v ? "0" : "1");
                } catch {
                  // 記憶できなくても切り替えはできる
                }
                return !v;
              })
            }
          />
          <div className="relative">
            <ToolbarButton icon="smile" label="絵文字" active={emojiOpen} onClick={() => setEmojiOpen((v) => !v)} />
            {emojiOpen && (
              <EmojiPicker
                className="absolute bottom-9 left-0"
                onClose={() => setEmojiOpen(false)}
                onSelect={(e) => {
                  setEmojiOpen(false);
                  insertAtCaret(e);
                }}
              />
            )}
          </div>
          <ToolbarButton icon="at" label="メンション" onClick={() => insertAtCaret("@")} />
          <span className="mx-1 h-5 w-px bg-[#1D1C1D21]" aria-hidden />
          <ToolbarButton icon="mic" label={listening ? "音声入力を停止" : "音声入力"} active={listening} onClick={toggleVoice} />
          {listening && <span className="text-[12px] font-bold text-[#E01E5A] animate-pulse">音声入力中…</span>}
          {tooLong && <span className="ml-1 text-[12px] font-bold text-[#E01E5A]">{text.length}/{MESSAGE_MAX_LENGTH}</span>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            className={`ml-auto flex h-7 w-8 items-center justify-center rounded-[4px] transition-colors ${
              canSend ? "bg-sk-green text-white hover:bg-sk-greenhover" : "text-[#1D1C1D4D]"
            }`}
            aria-label={sending ? "送信中" : "送信する"}
            title="送信する（Enter）"
          >
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-[999px] border-2 border-white/40 border-t-white" aria-hidden />
            ) : (
              <Icon name="send" className="w-4 h-4" filled={canSend} strokeWidth={canSend ? 1.5 : 2} />
            )}
          </button>
        </div>
      </div>
      <p className={`hidden md:block h-4 pt-0.5 text-right text-[11px] text-sk-mute ${text ? "visible" : "invisible"}`}>
        <b>Shift + Enter</b> で改行
      </p>
    </div>
  );
}
