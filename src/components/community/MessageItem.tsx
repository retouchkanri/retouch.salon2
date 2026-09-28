"use client";

import { memo, useEffect, useRef, useState } from "react";
import { QUICK_REACTIONS } from "@/lib/community/constants";
import {
  decodeMentions,
  formatBytes,
  formatDateTime,
  formatTime,
  isImageType,
  isMentioned,
  plainText,
  type KnownMention,
} from "@/lib/community/text";
import type { Message } from "@/lib/community/types";
import Avatar from "./Avatar";
import { Emoji } from "./Emoji";
import EmojiPicker from "./EmojiPicker";
import { Icon, type IconName } from "./icons";
import MessageBody from "./MessageBody";
import { Menu, MenuItem } from "./Sidebar";
import { useActions, useCS, useMe, useName, useNameOf } from "./store";
import { useOpenModal } from "./ui";

function Attachments({ msg }: { msg: Message }) {
  const signed = useCS((s) => {
    const out: Record<string, string | undefined> = {};
    for (const a of msg.attachments) out[a.path] = s.signed[a.path];
    return out;
  }, (a, b) => Object.keys(a).every((k) => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length);
  const images = msg.attachments.filter((a) => isImageType(a.type));
  const files = msg.attachments.filter((a) => !isImageType(a.type));
  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => {
            const url = signed[a.path];
            return url ? (
              <a key={a.path} href={url} target="_blank" rel="noopener noreferrer" title={a.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={a.name}
                  loading="lazy"
                  decoding="async"
                  className="max-h-[300px] max-w-full cursor-zoom-in rounded-[12px] border border-[#1E2B2421] bg-sk-soft object-contain sm:max-w-[360px]"
                />
              </a>
            ) : (
              <div key={a.path} className="h-32 w-48 animate-pulse rounded-[12px] border border-sk-line bg-sk-soft" aria-label="画像を読み込み中" />
            );
          })}
        </div>
      )}
      {files.map((a) => {
        const url = signed[a.path];
        return (
          <a
            key={a.path}
            href={url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex max-w-[360px] items-center gap-3 rounded-[12px] border border-[#1E2B2421] bg-white p-3 hover:bg-sk-soft ${
              url ? "" : "pointer-events-none opacity-60"
            }`}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-white ${
                a.type === "application/pdf" ? "bg-[#D2475E]" : "bg-[#2D8A62]"
              }`}
            >
              <Icon name="file" className="w-5 h-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold text-sk-text">{a.name}</span>
              <span className="block text-[13px] text-sk-mute">
                {a.type === "application/pdf" ? "PDF" : "ファイル"}
                {a.size ? `・${formatBytes(a.size)}` : ""}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function Reactions({ msg, canReact, onAdd }: { msg: Message; canReact: boolean; onAdd: () => void }) {
  const actions = useActions();
  const meId = useCS((s) => s.me.id);
  const nameOf = useNameOf();
  const entries = Object.entries(msg.reactions).filter(([, ids]) => ids.length > 0);
  const reactorKey = entries.flatMap(([, ids]) => ids.slice(0, 10)).join(",");
  useEffect(() => {
    if (reactorKey) actions.ensureUsers(reactorKey.split(","));
  }, [reactorKey, actions]);
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(meId);
        const names = ids.slice(0, 10).map((id) => (id === meId ? "あなた" : nameOf(id)));
        const more = ids.length > 10 ? ` 他${ids.length - 10}人` : "";
        return (
          <button
            key={emoji}
            type="button"
            disabled={!canReact}
            onClick={() => void actions.react(msg, emoji)}
            title={`${names.join("、")}${more} がリアクションしました`}
            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[12px] font-bold leading-none tabular-nums transition-all duration-150 active:scale-95 ${
              mine
                ? "border-[#2D8A62] bg-[#E6F3EC] text-sk-link"
                : "border-transparent bg-[#1E2B240F] text-sk-text hover:border-[#1E2B244D] hover:bg-white"
            } disabled:cursor-default`}
          >
            <Emoji emoji={emoji} size={16} />
            <span>{ids.length}</span>
          </button>
        );
      })}
      {canReact && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex h-6 w-8 items-center justify-center rounded-[12px] bg-[#1E2B240F] text-sk-mute opacity-0 group-hover:opacity-100 hover:border hover:border-[#1E2B244D] hover:bg-white focus:opacity-100"
          aria-label="リアクションを追加"
          title="リアクションを追加"
        >
          <Icon name="emojiAdd" className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function ThreadSummary({ msg }: { msg: Message }) {
  const actions = useActions();
  return (
    <button
      type="button"
      onClick={() => actions.openThread(msg.id)}
      className="group/thread mt-1 flex w-full max-w-[600px] items-center gap-2 rounded-[10px] border border-transparent p-1 pr-2 text-left hover:border-sk-line hover:bg-white"
    >
      <span className="flex gap-1">
        {msg.reply_user_ids.slice(0, 3).map((id) => (
          <Avatar key={id} userId={id} size={24} />
        ))}
      </span>
      <span className="text-[13px] font-bold text-sk-link hover:underline">{msg.reply_count}件の返信</span>
      {msg.last_reply_at && (
        <>
          <span className="text-[13px] text-sk-mute group-hover/thread:hidden">
            最終返信: {formatDateTime(msg.last_reply_at)}
          </span>
          <span className="hidden text-[13px] text-sk-mute group-hover/thread:inline">スレッドを表示する</span>
        </>
      )}
      <Icon name="chevronRight" className="ml-auto hidden w-4 h-4 text-sk-mute group-hover/thread:block" />
    </button>
  );
}

function EditBox({ msg, onDone }: { msg: Message; onDone: () => void }) {
  const actions = useActions();
  const nameOf = useNameOf();
  const initial = useRef(decodeMentions(msg.body, nameOf));
  const [text, setText] = useState(initial.current.text);
  const [known] = useState<KnownMention[]>(initial.current.known);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await actions.edit(msg, text, known);
    setSaving(false);
    if (ok) onDone();
  };

  return (
    <div className="mt-1 rounded-[12px] border border-[#1E2B244D] bg-white shadow-[0_0_0_1px_rgba(45,138,98,0.3)]">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Escape") onDone();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
        rows={1}
        className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[15px] leading-[1.46668] outline-none"
        maxLength={4000}
      />
      <div className="flex justify-end gap-2 px-2 pb-2">
        <button
          type="button"
          className="h-7 rounded-[8px] border border-[#1E2B244D] bg-white px-3 text-[13px] font-bold hover:bg-sk-soft"
          onClick={onDone}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="h-7 rounded-[8px] bg-sk-green px-3 text-[13px] font-bold text-white hover:bg-sk-greenhover disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  icon,
  emoji,
  active = false,
}: {
  label: string;
  onClick: () => void;
  icon?: IconName;
  emoji?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full text-sk-mute transition-all duration-150 hover:scale-110 hover:bg-[#E3F0E8] hover:text-[#2D6A4F] ${
        active ? "bg-[#E3F0E8] text-[#2D6A4F]" : ""
      }`}
      aria-label={label}
      title={label}
    >
      {emoji ? <Emoji emoji={emoji} size={18} /> : icon ? <Icon name={icon} /> : null}
    </button>
  );
}

function MessageItemInner({
  msg,
  grouped,
  inThread,
  dmRead,
  readCount,
  highlighted,
}: {
  msg: Message;
  grouped: boolean;
  inThread: boolean;
  dmRead: boolean | null;
  readCount: number | null;
  highlighted: boolean;
}) {
  const actions = useActions();
  const openModal = useOpenModal();
  const me = useMe();
  const author = useName(msg.user_id);
  const authorStaff = useCS((s) => (msg.user_id ? s.users[msg.user_id]?.is_staff ?? (msg.user_id === s.me.id && s.me.isStaff) : false));
  const chKind = useCS((s) => s.channels.find((c) => c.id === msg.channel_id)?.kind);
  const archived = useCS((s) => !!s.channels.find((c) => c.id === msg.channel_id)?.is_archived);
  const canManage = useCS((s) => !!s.channels.find((c) => c.id === msg.channel_id)?.can_manage);
  const pinnedBy = useName(msg.is_pinned ? msg.pinned_by : null);
  const nameOf = useNameOf();
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState(false);

  const own = !!msg.user_id && msg.user_id === me.id;
  const deleted = !!msg.deleted_at;
  const pending = msg.id.startsWith("optimistic:");
  const canReact = !deleted && !archived && !pending;
  const canReply = !inThread && !msg.parent_id && !deleted && !archived && !pending;
  const canEdit = own && !deleted && !archived && !pending;
  const canDelete = (own || me.isStaff) && !deleted && !pending;
  const canPin = !msg.parent_id && !deleted && !pending && (chKind === "dm" || canManage);
  const canReport = !own && !deleted && !!msg.user_id;
  const mentionsMe = !deleted && !own && isMentioned(msg, me.id);

  const copyLink = async () => {
    setMenuOpen(false);
    const url = new URL("/community", window.location.origin);
    url.searchParams.set("c", msg.channel_id);
    url.searchParams.set("m", msg.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      actions.pushToast({ kind: "info", title: "リンクをコピーしました。" });
    } catch {
      actions.pushToast({ kind: "error", title: "リンクをコピーできませんでした。" });
    }
  };

  const onDelete = async () => {
    setMenuOpen(false);
    const warn = !own ? "\n（運営として他の方のメッセージを削除します）" : "";
    if (!window.confirm(`このメッセージを削除しますか？この操作は取り消せません。${warn}`)) return;
    await actions.remove(msg);
  };

  const copyMessage = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(plainText(msg.body, nameOf, 100_000));
      actions.pushToast({ kind: "info", title: "メッセージをコピーしました。" });
    } catch {
      actions.pushToast({ kind: "error", title: "メッセージをコピーできませんでした。" });
    }
  };

  type MenuAction = "edit" | "unread" | "thread" | "link" | "copy" | "pin" | "report" | "delete";
  /** その他メニューの操作（クリックとショートカットキーの共通処理） */
  const runMenu = (a: MenuAction) => {
    setMenuOpen(false);
    if (a === "edit" && canEdit) setEditing(true);
    else if (a === "unread") void actions.markUnread(msg);
    else if (a === "thread" && canReply) actions.openThread(msg.id);
    else if (a === "link") void copyLink();
    else if (a === "copy" && msg.body) void copyMessage();
    else if (a === "pin" && canPin) void actions.pin(msg);
    else if (a === "report" && canReport) openModal({ type: "report", message: msg });
    else if (a === "delete" && canDelete) void onDelete();
  };

  // メニューを開いている間は、表示中のショートカットキーで操作できる
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const map: Record<string, MenuAction> = { e: "edit", u: "unread", t: "thread", l: "link", p: "pin" };
      let action: MenuAction | undefined;
      if ((e.ctrlKey || e.metaKey) && k === "c") action = "copy";
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && map[k]) action = map[k];
      else if (e.key === "Delete" || e.key === "Backspace") action = "delete";
      if (!action) return;
      e.preventDefault();
      runMenu(action);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  const showActions = !editing && !deleted && !pending;
  const openUser = () => {
    if (msg.user_id) openModal({ type: "user", userId: msg.user_id });
  };
  const toolbarVisible = selected || menuOpen || pickerOpen;

  return (
    <div
      id={`msg-${msg.id}`}
      className={`rc-msg group relative mx-2 flex gap-3 rounded-[14px] px-3 transition-colors duration-150 md:mx-3 ${grouped ? "py-[2px]" : "mt-1 pt-2 pb-1"} ${
        highlighted
          ? "bg-sk-yellow"
          : msg.is_pinned && !deleted
            ? "bg-sk-yellow"
            : mentionsMe
              ? "bg-[#FFF6E5] shadow-[inset_2px_0_0_#DB9A2E]"
              : editing
                ? "bg-sk-yellow"
                : toolbarVisible
                  ? "bg-sk-soft"
                  : "hover:bg-sk-soft"
      } ${pending ? "opacity-60" : ""}`}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("a,button,textarea,input")) return;
        if (window.matchMedia("(pointer: coarse)").matches) setSelected((v) => !v);
      }}
    >
      <div className="w-9 shrink-0">
        {grouped ? (
          <span
            className="block pr-1 text-right text-[12px] leading-[22px] text-sk-mute opacity-0 group-hover:opacity-100 tabular-nums"
            title={formatDateTime(msg.created_at)}
          >
            {formatTime(msg.created_at)}
          </span>
        ) : (
          <button type="button" onClick={openUser} className="mt-[3px] block" aria-label={`${author} のプロフィール`}>
            <Avatar userId={msg.user_id} size={36} />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {msg.is_pinned && !deleted && (
          <p className="mb-0.5 flex items-center gap-1 text-[12px] text-sk-mute">
            <Icon name="pin" className="w-3 h-3 text-[#DB9A2E]" />
            {msg.pinned_by ? `${pinnedBy} さんがピン留めしました` : "ピン留めされています"}
          </p>
        )}
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2 leading-[22px]">
            <button type="button" onClick={openUser} className="text-[15px] font-black text-sk-text hover:underline">
              {author}
            </button>
            {authorStaff && (
              <span className="rounded-full bg-[#E3F0E8] px-2 py-[1px] text-[10px] font-bold text-[#2D6A4F]">運営</span>
            )}
            <time
              className="text-[12px] text-sk-mute hover:underline tabular-nums"
              title={formatDateTime(msg.created_at)}
              dateTime={msg.created_at}
            >
              {formatTime(msg.created_at)}
            </time>
          </div>
        )}

        {deleted ? (
          <p className="text-[15px] italic text-sk-mute">このメッセージは削除されました。</p>
        ) : editing ? (
          <EditBox msg={msg} onDone={() => setEditing(false)} />
        ) : (
          <>
            {msg.body && <MessageBody body={msg.body} />}
            {msg.edited_at && <span className="text-[13px] text-sk-mute">（編集済み）</span>}
            {msg.attachments.length > 0 && <Attachments msg={msg} />}
          </>
        )}

        {!deleted && <Reactions msg={msg} canReact={canReact} onAdd={() => setPickerOpen(true)} />}

        {!inThread && !msg.parent_id && msg.reply_count > 0 && <ThreadSummary msg={msg} />}

        {!deleted && (dmRead || (readCount ?? 0) > 0) && (
          <div className="mt-0.5 text-[12px] text-sk-mute">
            {dmRead ? (
              <span className="inline-flex items-center gap-0.5">
                <Icon name="check" className="w-3 h-3" strokeWidth={3} />
                既読
              </span>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:underline"
                onClick={() => openModal({ type: "readers", userIds: actions.readersOf(msg), title: "既読のメンバー" })}
              >
                <Icon name="eye" className="w-3 h-3" />
                既読 {readCount}
              </button>
            )}
          </div>
        )}
      </div>

      {showActions && (
        <div
          className={`rc-anim-pop absolute right-3 top-1.5 z-[5] items-center gap-0.5 rounded-full border border-[#E2E9E4] bg-white/95 px-1 py-0.5 shadow-[0_6px_18px_rgba(30,43,36,0.12)] backdrop-blur ${
            toolbarVisible ? "flex" : "hidden group-hover:flex"
          }`}
        >
          {canReply && <ToolButton icon="thread" label="スレッドで返信する" onClick={() => actions.openThread(msg.id)} />}
          {canReply && canReact && <span className="mx-0.5 h-5 w-px bg-[#E2E9E4]" aria-hidden />}
          {canReact &&
            QUICK_REACTIONS.map((e) => (
              <ToolButton key={e} emoji={e} label={`${e} でリアクション`} onClick={() => void actions.react(msg, e)} />
            ))}
          {canReact && (
            <div className="relative">
              <ToolButton icon="emojiAdd" label="リアクションを追加する" onClick={() => setPickerOpen((v) => !v)} active={pickerOpen} />
              {pickerOpen && (
                <EmojiPicker
                  className="absolute right-0 top-9"
                  onClose={() => setPickerOpen(false)}
                  onSelect={(e) => {
                    setPickerOpen(false);
                    void actions.react(msg, e);
                  }}
                />
              )}
            </div>
          )}
          <div className="relative">
            <ToolButton icon="more" label="その他" onClick={() => setMenuOpen((v) => !v)} active={menuOpen} />
            {menuOpen && (
              <Menu onClose={() => setMenuOpen(false)} className="absolute right-0 top-9 w-[292px]">
                {canEdit && (
                  <>
                    <MenuItem icon="edit" hint="E" onClick={() => runMenu("edit")}>
                      メッセージを編集する
                    </MenuItem>
                    <div className="my-1 border-t border-sk-line" />
                  </>
                )}
                <MenuItem icon="eye" hint="U" onClick={() => runMenu("unread")}>
                  未読にする
                </MenuItem>
                {canReply && (
                  <MenuItem icon="thread" hint="T" onClick={() => runMenu("thread")}>
                    スレッドで返信する
                  </MenuItem>
                )}
                <div className="my-1 border-t border-sk-line" />
                <MenuItem icon="link" hint="L" onClick={() => runMenu("link")}>
                  リンクをコピーする
                </MenuItem>
                {!!msg.body && (
                  <MenuItem icon="copy" hint="Ctrl+C" onClick={() => runMenu("copy")}>
                    メッセージをコピーする
                  </MenuItem>
                )}
                {canPin && (
                  <>
                    <div className="my-1 border-t border-sk-line" />
                    <MenuItem icon="pin" hint="P" onClick={() => runMenu("pin")}>
                      {msg.is_pinned ? "ピン留めを外す" : "この会話にピン留めする"}
                    </MenuItem>
                  </>
                )}
                {(canReport || canDelete) && <div className="my-1 border-t border-sk-line" />}
                {canReport && (
                  <MenuItem icon="flag" onClick={() => runMenu("report")}>
                    運営に通報する
                  </MenuItem>
                )}
                {canDelete && (
                  <MenuItem icon="trash" hint="Delete" danger onClick={() => runMenu("delete")}>
                    メッセージを削除する…
                  </MenuItem>
                )}
              </Menu>
            )}
          </div>
        </div>
      )}
      {!showActions && pickerOpen && (
        <EmojiPicker
          className="absolute right-5 top-4"
          onClose={() => setPickerOpen(false)}
          onSelect={(e) => {
            setPickerOpen(false);
            void actions.react(msg, e);
          }}
        />
      )}
    </div>
  );
}

const MessageItem = memo(MessageItemInner);
export default MessageItem;
