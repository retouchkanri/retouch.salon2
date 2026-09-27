"use client";

import { useMemo } from "react";
import type { ChannelRow } from "@/lib/community/types";
import Avatar from "./Avatar";
import Composer from "./Composer";
import { Icon } from "./icons";
import MessageList from "./MessageList";
import { ChannelGlyph } from "./Sidebar";
import { shallowArray, useActions, useChannel, useCS, useMe, useName, useOnline } from "./store";
import { useOpenModal } from "./ui";

/** ヘッダー右側のメンバー表示（最近投稿した人のアイコン＋メンバー数。Slack と同じ） */
function MembersButton({ ch }: { ch: ChannelRow }) {
  const openModal = useOpenModal();
  const recent = useCS((s) => {
    const items = s.messages[ch.id]?.items ?? [];
    const out: string[] = [];
    for (let i = items.length - 1; i >= 0 && out.length < 3; i--) {
      const uid = items[i].user_id;
      if (uid && !out.includes(uid)) out.push(uid);
    }
    return out;
  }, shallowArray);
  return (
    <button
      type="button"
      onClick={() => openModal({ type: "details", channelId: ch.id, tab: "members" })}
      className="flex h-7 items-center gap-1.5 rounded-[6px] border border-sk-line pl-1 pr-2 text-[13px] font-bold text-sk-mute hover:bg-sk-soft"
      aria-label={`メンバー ${ch.member_count}人`}
      title="メンバーを表示"
    >
      <span className="flex -space-x-1.5">
        {recent.length > 0 ? (
          recent.map((id) => (
            <span key={id} className="rounded-[6px] ring-2 ring-white">
              <Avatar userId={id} size={20} />
            </span>
          ))
        ) : (
          <Icon name="users" className="w-4 h-4 mx-0.5" />
        )}
      </span>
      <span className="tabular-nums text-sk-text">{ch.member_count}</span>
    </button>
  );
}

function Header({ ch }: { ch: ChannelRow }) {
  const actions = useActions();
  const openModal = useOpenModal();
  const me = useMe();
  const isDm = ch.kind === "dm";
  const peerName = useName(isDm ? ch.dm_user_id : null);
  const peerOnline = useOnline(isDm ? ch.dm_user_id : null);
  const peerStaff = useCS((s) => (isDm && ch.dm_user_id ? !!s.users[ch.dm_user_id]?.is_staff : false));
  const pinnedCount = useCS((s) => (s.messages[ch.id]?.items ?? []).filter((m) => m.is_pinned && !m.deleted_at).length);
  const self = isDm && ch.dm_user_id === me.id;

  return (
    <header className="shrink-0 border-b border-sk-line">
      <div className="flex h-[49px] items-center gap-1 pl-2 pr-3 md:pl-4">
        <button
          type="button"
          onClick={() => actions.setMobileView("list")}
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-[6px] text-sk-text hover:bg-sk-soft"
          aria-label="一覧に戻る"
        >
          <Icon name="chevronLeft" className="w-6 h-6" />
        </button>
        <button
          type="button"
          onClick={() =>
            isDm && !self && ch.dm_user_id
              ? openModal({ type: "user", userId: ch.dm_user_id })
              : !isDm
                ? openModal({ type: "details", channelId: ch.id, tab: "about" })
                : undefined
          }
          className="flex min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left hover:bg-sk-soft"
        >
          {isDm ? (
            <Avatar userId={ch.dm_user_id} size={24} showOnline />
          ) : (
            <span className="text-sk-text">
              <ChannelGlyph ch={ch} className="w-[17px] h-[17px]" />
            </span>
          )}
          <span className="truncate text-[18px] font-black text-sk-text">
            {isDm ? (self ? `${peerName}（自分）` : peerName) : ch.name}
          </span>
          {isDm && peerStaff && (
            <span className="rounded-[3px] bg-[#1D1C1D14] px-1 py-[1px] text-[10px] font-bold text-sk-mute">運営</span>
          )}
          <Icon name="caretDown" className="w-4 h-4 text-sk-text" strokeWidth={2.5} />
        </button>
        {isDm && !self && peerOnline && <span className="hidden sm:inline text-[13px] text-sk-mute">アクティブ</span>}
        {!isDm && ch.topic && (
          <span className="hidden lg:block min-w-0 flex-1 truncate border-l border-sk-line pl-3 text-[13px] text-sk-mute">
            {ch.topic}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!isDm && <MembersButton ch={ch} />}
          <button
            type="button"
            onClick={() => openModal({ type: "search", channelId: ch.id })}
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-[6px] text-sk-mute hover:bg-sk-soft hover:text-sk-text"
            aria-label="この会話を検索"
            title="この会話を検索"
          >
            <Icon name="search" />
          </button>
          {!isDm && (
            <button
              type="button"
              onClick={() => openModal({ type: "details", channelId: ch.id, tab: "settings" })}
              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-sk-mute hover:bg-sk-soft hover:text-sk-text"
              aria-label="チャンネルの設定"
              title="チャンネルの設定"
            >
              <Icon name="more" />
            </button>
          )}
        </div>
      </div>
      <div className="flex h-9 items-end gap-4 px-4 text-[13px] font-bold" role="tablist">
        <span role="tab" aria-selected="true" className="flex h-9 items-center gap-1.5 border-b-2 border-sk-text text-sk-text">
          <Icon name="dm" className="w-4 h-4" />
          メッセージ
        </span>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          onClick={() => openModal({ type: "pinned", channelId: ch.id })}
          className="flex h-9 items-center gap-1.5 border-b-2 border-transparent text-sk-mute hover:text-sk-text"
        >
          <Icon name="pin" className="w-4 h-4" />
          ピン留め{pinnedCount > 0 ? ` ${pinnedCount}` : ""}
        </button>
        {!isDm && (ch.joined || me.isStaff) && (
          <button
            type="button"
            onClick={() => void actions.toggleStar(ch.id)}
            className={`ml-auto flex h-9 items-center gap-1 border-b-2 border-transparent ${
              ch.is_starred ? "text-[#E8912D]" : "text-sk-mute hover:text-sk-text"
            }`}
            aria-pressed={ch.is_starred}
            title={ch.is_starred ? "スターを外す" : "スターを付ける"}
          >
            <Icon name="star" className="w-4 h-4" filled={ch.is_starred} />
            <span className="hidden sm:inline">{ch.is_starred ? "スター付き" : "スター"}</span>
          </button>
        )}
      </div>
    </header>
  );
}

function Footer({ ch }: { ch: ChannelRow }) {
  const actions = useActions();
  const openModal = useOpenModal();
  const me = useMe();
  const isDm = ch.kind === "dm";
  const dmName = useName(isDm ? ch.dm_user_id : null);
  const profileReady = me.isStaff || !!me.profile?.display_name;

  if (ch.is_archived) {
    return (
      <div className="mx-5 mb-5 flex flex-wrap items-center justify-center gap-3 rounded-[8px] border border-sk-line bg-sk-soft px-4 py-4 text-[15px] text-sk-text">
        <Icon name="archive" />
        <span>
          アーカイブされたチャンネル <b>#{ch.name}</b> を閲覧しています
        </span>
        {ch.can_manage && (
          <button
            type="button"
            className="h-8 rounded-[4px] border border-[#1D1C1D4D] bg-white px-3 text-[13px] font-bold hover:bg-sk-soft"
            onClick={() => void actions.archiveChannel(ch.id, false)}
          >
            アーカイブを解除する
          </button>
        )}
      </div>
    );
  }
  if (!isDm && !ch.joined) {
    return (
      <div className="flex flex-col items-center gap-3 border-t border-sk-line bg-sk-soft px-4 py-5 text-center">
        <p className="text-[15px] text-sk-text">
          <span className="inline-flex items-center gap-1 font-bold">
            <ChannelGlyph ch={ch} />
            {ch.name}
          </span>{" "}
          をプレビューしています
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="h-9 rounded-[4px] border border-[#1D1C1D4D] bg-white px-4 text-[15px] font-bold hover:bg-white/80"
            onClick={() => openModal({ type: "details", channelId: ch.id, tab: "about" })}
          >
            詳細
          </button>
          <button
            type="button"
            className="h-9 rounded-[4px] bg-sk-green px-4 text-[15px] font-bold text-white hover:bg-sk-greenhover"
            onClick={() => void actions.join(ch.id)}
          >
            チャンネルに参加する
          </button>
        </div>
      </div>
    );
  }
  if (!profileReady) {
    return (
      <div className="mx-5 mb-5 flex flex-wrap items-center gap-3 rounded-[8px] border border-[#E8912D66] bg-sk-yellow px-4 py-3 text-[15px]">
        <span className="flex-1">メッセージを送るには、コミュニティで表示する名前を設定してください。</span>
        <button
          type="button"
          className="h-8 rounded-[4px] bg-sk-green px-3 text-[13px] font-bold text-white hover:bg-sk-greenhover"
          onClick={() => openModal({ type: "profile" })}
        >
          表示名を設定する
        </button>
      </div>
    );
  }
  if (!ch.can_post) {
    return (
      <div className="mx-5 mb-5 flex items-start gap-2 rounded-[8px] border border-sk-line bg-sk-soft px-4 py-3 text-[14px] text-sk-mute">
        <Icon name="info" className="mt-0.5 w-4 h-4" />
        <span>
          このチャンネルでは運営のみがメッセージを投稿できます。各メッセージの「スレッドで返信する」からご質問・ご感想をお送りください。
        </span>
      </div>
    );
  }
  return (
    <Composer
      channelId={ch.id}
      placeholder={isDm ? `${dmName} へのメッセージ` : `#${ch.name} へのメッセージ`}
    />
  );
}

function Typing({ channelId }: { channelId: string }) {
  const ids = useCS((s) => {
    const now = Date.now();
    return Object.entries(s.typing[channelId] ?? {})
      .filter(([, exp]) => exp > now)
      .map(([id]) => id);
  }, shallowArray);
  const users = useCS((s) => s.users);
  const me = useMe();
  const names = useMemo(
    () => ids.map((id) => (id === me.id ? me.profile?.display_name ?? "あなた" : users[id]?.display_name ?? "会員")),
    [ids, users, me],
  );
  return (
    <div className="h-5 shrink-0 truncate px-5 text-[12px] text-sk-mute" aria-live="polite">
      {names.length > 0 &&
        (names.length > 2 ? (
          <b>複数の人</b>
        ) : (
          names.map((n, i) => (
            <span key={i}>
              {i > 0 && "、"}
              <b>{n}</b>
            </span>
          ))
        ))}
      {names.length > 0 && " が入力中…"}
    </div>
  );
}

function Welcome() {
  const openModal = useOpenModal();
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-sk-mute">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" className="mb-4 h-16 w-16 rounded-[12px]" />
      <p className="text-[22px] font-black text-sk-text">Retouch コミュニティへようこそ</p>
      <p className="mt-2 text-[15px]">左のチャンネルやダイレクトメッセージを選んでください。</p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => openModal({ type: "browse" })}
          className="h-9 rounded-[4px] border border-[#1D1C1D4D] px-4 text-[15px] font-bold text-sk-text hover:bg-sk-soft"
        >
          チャンネル一覧
        </button>
        <button
          type="button"
          onClick={() => openModal({ type: "create" })}
          className="h-9 rounded-[4px] bg-sk-green px-4 text-[15px] font-bold text-white hover:bg-sk-greenhover"
        >
          チャンネルを作成する
        </button>
      </div>
    </div>
  );
}

export default function ChannelPane() {
  const currentId = useCS((s) => s.currentId);
  const ch = useChannel(currentId);
  if (!ch) return <Welcome />;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <Header ch={ch} />
      <MessageList channelId={ch.id} />
      <div className="shrink-0">
        <Footer ch={ch} />
        {!ch.is_archived && (ch.kind === "dm" || ch.joined) && <Typing channelId={ch.id} />}
      </div>
    </div>
  );
}
