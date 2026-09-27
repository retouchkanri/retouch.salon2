"use client";

import { useEffect, useMemo, useRef } from "react";
import { shouldGroup } from "@/lib/community/text";
import Composer from "./Composer";
import { Icon } from "./icons";
import MessageItem from "./MessageItem";
import { ChannelGlyph } from "./Sidebar";
import { useActions, useChannel, useCS, useMe, useName } from "./store";
import { useOpenModal } from "./ui";

/** スレッド（右側のパネル。スマホは全画面）。 */
export default function ThreadPane() {
  const actions = useActions();
  const openModal = useOpenModal();
  const threadParentId = useCS((s) => s.threadParentId);
  const parent = useCS((s) => (s.threadParentId ? s.threadParents[s.threadParentId] ?? null : null));
  const t = useCS((s) => (s.threadParentId ? s.threads[s.threadParentId] : undefined));
  const highlightId = useCS((s) => s.highlightId);
  const ch = useChannel(parent?.channel_id);
  const me = useMe();
  const dmName = useName(ch?.kind === "dm" ? ch.dm_user_id : null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const replies = useMemo(() => (t?.items ?? []).filter((m) => !m.deleted_at), [t?.items]);
  const count = replies.length;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, threadParentId]);

  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`msg-${highlightId}`)?.scrollIntoView({ block: "center" });
  }, [highlightId, count]);

  if (!threadParentId) return null;
  const profileReady = me.isStaff || !!me.profile?.display_name;
  const canReply = !!parent && !parent.deleted_at && !!ch && !ch.is_archived;

  return (
    <aside className="fixed inset-0 z-[140] flex flex-col bg-white md:static md:z-auto md:w-[400px] md:shrink-0 md:border-l md:border-sk-line lg:border-l-0">
      <header className="flex h-[49px] shrink-0 items-center gap-2 border-b border-sk-line pl-5 pr-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="text-[18px] font-black text-sk-text">スレッド</p>
          {ch && (
            <p className="flex min-w-0 items-center gap-0.5 truncate text-[13px] text-sk-mute">
              {ch.kind === "dm" ? (
                dmName
              ) : (
                <>
                  <ChannelGlyph ch={ch} className="w-3 h-3" />
                  {ch.name}
                </>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => actions.openThread(null)}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-[6px] text-sk-mute hover:bg-sk-soft hover:text-sk-text"
          aria-label="スレッドを閉じる"
        >
          <Icon name="close" className="w-5 h-5" />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-2 pt-2 sk-scroll-light">
        {parent ? (
          <MessageItem msg={parent} grouped={false} inThread dmRead={null} readCount={null} highlighted={false} />
        ) : (
          <div className="flex gap-2 px-5 pt-2 animate-pulse">
            <div className="h-9 w-9 rounded-[8px] bg-[#1D1C1D12]" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-32 rounded-[3px] bg-[#1D1C1D12]" />
              <div className="h-3 w-3/4 rounded-[3px] bg-[#1D1C1D0D]" />
            </div>
          </div>
        )}
        <div className="my-2 flex items-center gap-3 px-5">
          <span className="text-[13px] text-sk-mute">{count > 0 ? `${count}件の返信` : "返信はまだありません"}</span>
          <span className="flex-1 border-t border-sk-line" aria-hidden />
        </div>
        {t?.loading && replies.length === 0 && (
          <p className="px-5 text-[13px] text-sk-mute animate-pulse">読み込み中…</p>
        )}
        {replies.map((m, i) => (
          <MessageItem
            key={m.id}
            msg={m}
            grouped={shouldGroup(replies[i - 1], m)}
            inThread
            dmRead={null}
            readCount={null}
            highlighted={highlightId === m.id}
          />
        ))}
      </div>

      <div className="shrink-0 pt-1">
        {!canReply ? (
          <p className="mx-5 mb-4 text-[13px] text-sk-mute">このスレッドには返信できません。</p>
        ) : !profileReady ? (
          <div className="mx-4 mb-4 rounded-[8px] border border-[#E8912D66] bg-sk-yellow px-4 py-3 text-[14px]">
            <button type="button" className="font-bold text-sk-link hover:underline" onClick={() => openModal({ type: "profile" })}>
              表示名を設定
            </button>
            すると返信できます。
          </div>
        ) : (
          <Composer channelId={parent!.channel_id} parentId={threadParentId} placeholder="返信する…" />
        )}
      </div>
    </aside>
  );
}
