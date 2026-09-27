"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dayKey, formatDayLabel, isVisibleMessage, shouldGroup } from "@/lib/community/text";
import type { ChannelRow, Message } from "@/lib/community/types";
import Avatar from "./Avatar";
import { Icon } from "./icons";
import MessageItem from "./MessageItem";
import { ChannelGlyph } from "./Sidebar";
import { useActions, useChannel, useCS, useMe, useName } from "./store";
import { useOpenModal } from "./ui";

function toMs(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(d);
}

/** チャンネル・DM の最初に出る案内（Slack と同じ） */
function Intro({ ch }: { ch: ChannelRow }) {
  const openModal = useOpenModal();
  const me = useMe();
  const creator = useName(ch.created_by);
  const peer = useName(ch.kind === "dm" ? ch.dm_user_id : null);
  if (ch.kind === "dm") {
    const self = ch.dm_user_id === me.id;
    return (
      <div className="px-5 pb-4 pt-10">
        <Avatar userId={ch.dm_user_id} size={72} />
        <p className="mt-3 text-[22px] font-black text-sk-text">{self ? `${peer}（自分）` : peer}</p>
        <p className="mt-1 text-[15px] text-sk-mute">
          {self ? (
            "ここはあなた専用のスペースです。メモやリンク、下書きの置き場所にどうぞ。"
          ) : (
            <>
              このダイレクトメッセージは、あなたと <b className="text-sk-text">@{peer}</b> さんだけが見られます。
            </>
          )}
        </p>
      </div>
    );
  }
  const canAddMembers = !ch.is_archived && ch.joined && !(ch.visibility === "public" && ch.auto_join) && ch.audience === "all";
  const canEdit = !ch.is_archived && (ch.can_manage || (ch.joined && ch.post_policy === "everyone"));
  return (
    <div className="px-5 pb-4 pt-10">
      <p className="flex items-center gap-1.5 text-[22px] font-black text-sk-text">
        <ChannelGlyph ch={ch} className="w-[22px] h-[22px]" />
        {ch.name}
      </p>
      <p className="mt-1 text-[15px] text-sk-mute">
        {ch.created_by ? (
          <>
            <b className="text-sk-link">@{creator}</b> さんがこのチャンネルを {formatFullDate(ch.created_at)} に作成しました。
          </>
        ) : (
          <>このチャンネルは {formatFullDate(ch.created_at)} に作成されました。</>
        )}
        これは <b className="text-sk-text">#{ch.name}</b> チャンネルの一番最初です。
        {ch.description && <> {ch.description}</>}
      </p>
      {(canEdit || canAddMembers) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => openModal({ type: "details", channelId: ch.id, tab: "about" })}
              className="flex h-8 items-center gap-1.5 rounded-[4px] border border-[#1D1C1D4D] px-3 text-[13px] font-bold text-sk-text hover:bg-sk-soft"
            >
              <Icon name="edit" className="w-4 h-4" />
              {ch.description ? "説明を編集" : "説明を追加"}
            </button>
          )}
          {canAddMembers && (
            <button
              type="button"
              onClick={() => openModal({ type: "invite", channelId: ch.id })}
              className="flex h-8 items-center gap-1.5 rounded-[4px] border border-[#1D1C1D4D] px-3 text-[13px] font-bold text-sk-text hover:bg-sk-soft"
            >
              <Icon name="userPlus" className="w-4 h-4" />
              メンバーを追加
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type Day = { key: string; label: string; items: Message[] };

export default function MessageList({ channelId }: { channelId: string }) {
  const actions = useActions();
  const st = useCS((s) => s.messages[channelId]);
  const ch = useChannel(channelId);
  const divider = useCS((s) => s.dividerAt[channelId] ?? null);
  const highlightId = useCS((s) => s.highlightId);
  const receipts = useCS((s) => s.receipts);
  const me = useMe();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const initialScrollDone = useRef<string | null>(null);
  const lastCount = useRef(0);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    void actions.loadChannel(channelId);
  }, [actions, channelId]);

  const items = useMemo(() => (st?.items ?? []).filter(isVisibleMessage), [st?.items]);
  const firstUnreadId = useMemo(() => {
    if (!divider) return null;
    const t = toMs(divider);
    return items.find((m) => toMs(m.created_at) > t && m.user_id !== me.id)?.id ?? null;
  }, [items, divider, me.id]);

  const days = useMemo(() => {
    const out: Day[] = [];
    for (const m of items) {
      const k = dayKey(m.created_at);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(m);
      else out.push({ key: k, label: formatDayLabel(m.created_at), items: [m] });
    }
    return out;
  }, [items]);

  // 既読（DM: 相手が読んだか / チャンネル: 読んだ人数）。自分の投稿と、運営には全投稿に表示。
  const readOf = useCallback(
    (m: Message): { dmRead: boolean | null; readCount: number | null } => {
      if (!ch || m.deleted_at) return { dmRead: null, readCount: null };
      const created = toMs(m.created_at);
      if (ch.kind === "dm") {
        if (m.user_id !== me.id || !ch.dm_user_id || ch.dm_user_id === me.id) return { dmRead: null, readCount: null };
        const peerAt = receipts[ch.dm_user_id];
        return { dmRead: !!peerAt && toMs(peerAt) >= created, readCount: null };
      }
      if (m.user_id !== me.id && !me.isStaff) return { dmRead: null, readCount: null };
      let n = 0;
      for (const [uid, at] of Object.entries(receipts)) if (uid !== m.user_id && toMs(at) >= created) n++;
      return { dmRead: null, readCount: n };
    },
    [ch, receipts, me.id, me.isStaff],
  );

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottom.current = true;
    setShowNew(false);
  }, []);

  // チャンネルを開いた直後: 未読の区切りか最下部へ
  useLayoutEffect(() => {
    if (!st?.loaded || initialScrollDone.current === channelId) return;
    initialScrollDone.current = channelId;
    lastCount.current = items.length;
    const el = scrollRef.current;
    if (!el) return;
    const target = firstUnreadId ? document.getElementById(`unread-${channelId}`) : null;
    if (target) {
      el.scrollTop = Math.max(0, target.offsetTop - 80);
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    } else {
      scrollToBottom();
    }
  }, [st?.loaded, channelId, items.length, firstUnreadId, scrollToBottom]);

  // 過去分の読み込み・新着
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || initialScrollDone.current !== channelId) return;
    if (prepend.current) {
      el.scrollTop = el.scrollHeight - prepend.current.height + prepend.current.top;
      prepend.current = null;
      lastCount.current = items.length;
      return;
    }
    if (items.length > lastCount.current) {
      const last = items[items.length - 1];
      if (atBottom.current || last?.user_id === me.id) scrollToBottom(true);
      else setShowNew(true);
    }
    lastCount.current = items.length;
  }, [items, channelId, me.id, scrollToBottom]);

  // 画像の読み込みなどで高さが変わっても、最下部を見ているなら最下部に留まる
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current && !prepend.current) {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [channelId, st?.loaded]);

  // 検索結果・リンクからの移動
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`msg-${highlightId}`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      atBottom.current = false;
    }
  }, [highlightId, items.length]);

  const requestOlder = useCallback(async () => {
    const el = scrollRef.current;
    if (!el || !st?.hasMore || st.loading) return;
    prepend.current = { height: el.scrollHeight, top: el.scrollTop };
    const more = await actions.loadOlder(channelId);
    if (!more) prepend.current = null;
  }, [st?.hasMore, st?.loading, actions, channelId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom.current) setShowNew(false);
    if (el.scrollTop < 200 && st?.hasMore && !st.loading && st.loaded) void requestOlder();
  };

  if (!st || (!st.loaded && !st.error)) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden px-5 pt-6" aria-busy="true" aria-label="読み込み中">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mb-5 flex gap-2 animate-pulse">
            <div className="h-9 w-9 rounded-[8px] bg-[#1D1C1D12]" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-32 rounded-[3px] bg-[#1D1C1D12]" />
              <div className="h-3 rounded-[3px] bg-[#1D1C1D0D]" style={{ width: `${70 - i * 12}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (st.error && !st.loaded) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-[15px] text-[#E01E5A]">{st.error}</div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overscroll-contain sk-scroll-light">
        <div ref={contentRef} className="pb-3">
          {st.hasMore ? (
            <div className="flex justify-center py-4 text-[13px] text-sk-mute">
              {st.loading ? (
                <span className="h-5 w-5 animate-spin rounded-[999px] border-2 border-sk-line border-t-sk-mute" aria-label="読み込み中" />
              ) : (
                <button type="button" onClick={() => void requestOlder()} className="text-sk-link hover:underline">
                  以前のメッセージを読み込む
                </button>
              )}
            </div>
          ) : (
            ch && <Intro ch={ch} />
          )}

          {days.map((d) => (
            <section key={d.key} aria-label={d.label}>
              <div className="sticky top-0 z-[3] flex h-7 items-center justify-center" role="separator">
                <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-sk-line" aria-hidden />
                <span className="relative rounded-[24px] border border-sk-line bg-white px-4 py-[3px] text-[13px] font-bold text-sk-text shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
                  {d.label}
                </span>
              </div>
              {d.items.map((m, i) => {
                const prev = d.items[i - 1];
                const isFirstUnread = m.id === firstUnreadId;
                const { dmRead, readCount } = readOf(m);
                return (
                  <div key={m.id}>
                    {isFirstUnread && (
                      <div id={`unread-${channelId}`} className="relative my-1 flex items-center" role="separator">
                        <span className="flex-1 border-t border-sk-red" aria-hidden />
                        <span className="absolute right-4 -top-2 bg-white px-1 text-[13px] font-bold text-sk-red">新規</span>
                      </div>
                    )}
                    <MessageItem
                      msg={m}
                      grouped={!isFirstUnread && shouldGroup(prev, m)}
                      inThread={false}
                      dmRead={dmRead}
                      readCount={readCount}
                      highlighted={highlightId === m.id}
                    />
                  </div>
                );
              })}
            </section>
          ))}

          {items.length === 0 && !st.hasMore && (
            <p className="px-5 text-[15px] text-sk-mute">まだメッセージはありません。最初のメッセージを送ってみましょう。</p>
          )}
        </div>
      </div>

      {showNew && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-3 left-1/2 z-[10] flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-[16px] bg-[#1D9BD1] px-4 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:bg-[#1A8DBF]"
        >
          <Icon name="arrowDown" className="w-4 h-4" strokeWidth={2.5} />
          新しいメッセージ
        </button>
      )}
    </div>
  );
}
