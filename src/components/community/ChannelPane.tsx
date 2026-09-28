"use client";

import { useMemo } from "react";
import type { ChannelRow } from "@/lib/community/types";
import Avatar, { PresenceDot } from "./Avatar";
import Composer from "./Composer";
import { Icon } from "./icons";
import MessageList from "./MessageList";
import { ChannelGlyph } from "./Sidebar";
import { PRESENCE_LABEL, shallowArray, useActions, useChannel, useCS, useMe, useName, usePresence } from "./store";
import { useOpenModal } from "./ui";
import UserMenu from "./UserMenu";

/** ヘッダー右側のメンバー表示（最近投稿した人のアイコン＋メンバー数） */
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
      className="flex h-9 items-center gap-2 rounded-full bg-[#F1F5F2] pl-1.5 pr-3 text-[13px] font-bold text-sk-mute transition-colors hover:bg-[#E3F0E8] hover:text-[#2D6A4F]"
      aria-label={`メンバー ${ch.member_count}人`}
      title="メンバーを表示"
    >
      <span className="flex -space-x-2">
        {recent.length > 0 ? (
          recent.map((id) => (
            <span key={id} className="rounded-full ring-2 ring-[#F1F5F2]">
              <Avatar userId={id} size={22} />
            </span>
          ))
        ) : (
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white">
            <Icon name="users" className="w-3.5 h-3.5" />
          </span>
        )}
      </span>
      <span className="tabular-nums text-sk-text">{ch.member_count}</span>
    </button>
  );
}

function HeaderIconButton({
  label,
  onClick,
  children,
  active = false,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 hover:-translate-y-0.5 ${
        active ? "bg-[#FFF3DC] text-[#C98A1B]" : "text-sk-mute hover:bg-[#F1F5F2] hover:text-sk-text"
      } ${className}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function Header({ ch }: { ch: ChannelRow }) {
  const actions = useActions();
  const openModal = useOpenModal();
  const me = useMe();
  const isDm = ch.kind === "dm";
  const peerName = useName(isDm ? ch.dm_user_id : null);
  const peerPresence = usePresence(isDm ? ch.dm_user_id : null);
  const peerStaff = useCS((s) => (isDm && ch.dm_user_id ? !!s.users[ch.dm_user_id]?.is_staff : false));
  const pinnedCount = useCS((s) => (s.messages[ch.id]?.items ?? []).filter((m) => m.is_pinned && !m.deleted_at).length);
  const self = isDm && ch.dm_user_id === me.id;
  const canStar = !isDm && (ch.joined || me.isStaff);

  return (
    <header className="shrink-0 border-b border-[#EDF2EE] bg-white/90 backdrop-blur">
      <div className="flex h-[64px] items-center gap-2 pl-2 pr-3 md:pl-5 md:pr-4">
        <button
          type="button"
          onClick={() => actions.setMobileView("list")}
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-full text-sk-text hover:bg-sk-soft"
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
          className="group flex min-w-0 items-center gap-3 rounded-[14px] py-1 pl-1 pr-3 text-left transition-colors hover:bg-[#F6F9F7]"
        >
          {isDm ? (
            <Avatar userId={ch.dm_user_id} size={38} showOnline />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#E3F0E8] text-[#2D6A4F] transition-transform duration-200 group-hover:rotate-[-6deg]">
              <ChannelGlyph ch={ch} className="w-[18px] h-[18px]" size={24} />
            </span>
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[17px] font-bold text-sk-text">
                {isDm ? (self ? `${peerName}（自分）` : peerName) : ch.name}
              </span>
              {isDm && peerStaff && (
                <span className="rounded-full bg-[#E3F0E8] px-2 py-[1px] text-[10px] font-bold text-[#2D6A4F]">運営</span>
              )}
              <Icon name="caretDown" className="w-3.5 h-3.5 text-sk-mute" strokeWidth={2.5} />
            </span>
            {isDm ? (
              !self && (
                <span className="flex items-center gap-1.5 text-[12px] text-sk-mute">
                  <PresenceDot presence={peerPresence} size={7} ring="transparent" />
                  {PRESENCE_LABEL[peerPresence]}
                </span>
              )
            ) : (
              <span className="block max-w-[46ch] truncate text-[12px] text-sk-mute">
                {ch.topic || `${ch.member_count}人のメンバー`}
              </span>
            )}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          {!isDm && <MembersButton ch={ch} />}
          <button
            type="button"
            onClick={() => openModal({ type: "pinned", channelId: ch.id })}
            className="hidden sm:flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold text-sk-mute transition-colors hover:bg-[#F1F5F2] hover:text-sk-text"
            title="ピン留めしたメッセージ"
          >
            <Icon name="pin" className="w-4 h-4" />
            ピン留め
            {pinnedCount > 0 && (
              <span className="rounded-full bg-[#FFF3DC] px-1.5 text-[11px] tabular-nums text-[#C98A1B]">{pinnedCount}</span>
            )}
          </button>
          <HeaderIconButton
            label="ピン留めしたメッセージ"
            onClick={() => openModal({ type: "pinned", channelId: ch.id })}
            className="sm:hidden"
          >
            <Icon name="pin" className="w-[18px] h-[18px]" />
          </HeaderIconButton>
          {canStar && (
            <HeaderIconButton
              label={ch.is_starred ? "スターを外す" : "スターを付ける"}
              onClick={() => void actions.toggleStar(ch.id)}
              active={ch.is_starred}
            >
              <Icon name="star" className="w-[18px] h-[18px]" filled={ch.is_starred} />
            </HeaderIconButton>
          )}
          <HeaderIconButton
            label="この会話を検索"
            onClick={() => openModal({ type: "search", channelId: ch.id })}
            className="hidden sm:flex"
          >
            <Icon name="search" className="w-[18px] h-[18px]" />
          </HeaderIconButton>
          {!isDm && (
            <HeaderIconButton
              label="チャンネルの設定"
              onClick={() => openModal({ type: "details", channelId: ch.id, tab: "settings" })}
            >
              <Icon name="more" className="w-[18px] h-[18px]" />
            </HeaderIconButton>
          )}
          <span className="mx-1.5 h-6 w-px bg-[#E2E9E4]" aria-hidden />
          <UserMenu />
        </div>
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
      <div className="mx-5 mb-5 flex flex-wrap items-center justify-center gap-3 rounded-[12px] border border-sk-line bg-sk-soft px-4 py-4 text-[15px] text-sk-text">
        <Icon name="archive" />
        <span>
          アーカイブされたチャンネル <b>#{ch.name}</b> を閲覧しています
        </span>
        {ch.can_manage && (
          <button
            type="button"
            className="h-8 rounded-[8px] border border-[#1E2B244D] bg-white px-3 text-[13px] font-bold hover:bg-sk-soft"
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
            className="h-9 rounded-[8px] border border-[#1E2B244D] bg-white px-4 text-[15px] font-bold hover:bg-white/80"
            onClick={() => openModal({ type: "details", channelId: ch.id, tab: "about" })}
          >
            詳細
          </button>
          <button
            type="button"
            className="h-9 rounded-[8px] bg-sk-green px-4 text-[15px] font-bold text-white hover:bg-sk-greenhover"
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
      <div className="mx-5 mb-5 flex flex-wrap items-center gap-3 rounded-[12px] border border-[#DB9A2E66] bg-sk-yellow px-4 py-3 text-[15px]">
        <span className="flex-1">メッセージを送るには、コミュニティで表示する名前を設定してください。</span>
        <button
          type="button"
          className="h-8 rounded-[8px] bg-sk-green px-3 text-[13px] font-bold text-white hover:bg-sk-greenhover"
          onClick={() => openModal({ type: "profile" })}
        >
          表示名を設定する
        </button>
      </div>
    );
  }
  if (!ch.can_post) {
    return (
      <div className="mx-5 mb-5 flex items-start gap-2 rounded-[12px] border border-sk-line bg-sk-soft px-4 py-3 text-[14px] text-sk-mute">
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[64px] shrink-0 items-center justify-end border-b border-[#EDF2EE] px-4">
        <UserMenu />
      </div>
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-sk-mute rc-anim-fade-up">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" className="mb-4 h-16 w-16 rounded-[12px]" />
      <p className="text-[22px] font-black text-sk-text">Retouch コミュニティへようこそ</p>
      <p className="mt-2 text-[15px]">左のチャンネルやダイレクトメッセージを選んでください。</p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => openModal({ type: "browse" })}
          className="h-9 rounded-[8px] border border-[#1E2B244D] px-4 text-[15px] font-bold text-sk-text hover:bg-sk-soft"
        >
          チャンネル一覧
        </button>
        <button
          type="button"
          onClick={() => openModal({ type: "create" })}
          className="h-9 rounded-[8px] bg-sk-green px-4 text-[15px] font-bold text-white hover:bg-sk-greenhover"
        >
          チャンネルを作成する
        </button>
      </div>
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
