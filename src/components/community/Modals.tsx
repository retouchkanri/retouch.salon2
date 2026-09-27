"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/community/api";
import {
  BIO_MAX,
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_TOPIC_MAX,
  DISPLAY_NAME_MAX,
  MEMBER_CODE_LABELS,
  NOTIFY_LABELS,
  NOTIFY_LEVELS,
  type MemberCode,
} from "@/lib/community/constants";
import {
  CHANNEL_NAME_LIMIT,
  channelNameProblem,
  effectiveNotify,
  formatDateTime,
  normalizeChannelName,
  plainText,
  sortChannels,
} from "@/lib/community/text";
import type { ChannelRow, Message, SearchHit, UserInfo } from "@/lib/community/types";
import Avatar from "./Avatar";
import { Icon } from "./icons";
import MessageBody from "./MessageBody";
import Modal, { PrimaryButton, SecondaryButton, inputClass } from "./Modal";
import { ChannelGlyph } from "./Sidebar";
import { useActions, useChannel, useCS, useMe, useName, useNameOf, useOnline, useUser } from "./store";
import { useOpenModal, useUi, type DetailsTab } from "./ui";

const textareaClass = `${inputClass} h-auto py-2 leading-[1.46668]`;

function StaffTag() {
  return <span className="rounded-[3px] bg-[#1D1C1D14] px-1 py-[1px] text-[10px] font-bold text-sk-mute">運営</span>;
}

// ---------------------------------------------------------------------------
// プロフィール（表示名）
// ---------------------------------------------------------------------------

function ProfileModal({ onClose }: { onClose: () => void }) {
  const actions = useActions();
  const me = useMe();
  const [name, setName] = useState(me.profile?.display_name ?? "");
  const [bio, setBio] = useState(me.profile?.bio ?? "");
  const [allowDm, setAllowDm] = useState(me.profile?.allow_dm ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = !me.isStaff && !me.profile?.setup_done;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > DISPLAY_NAME_MAX) {
      setError(`表示名は1〜${DISPLAY_NAME_MAX}文字で入力してください。`);
      return;
    }
    setError(null);
    setSaving(true);
    const ok = await actions.saveProfile({ displayName: trimmed, bio, allowDm });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={first ? "Retouch コミュニティへようこそ" : "プロフィールを編集"}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>{first ? "あとで" : "キャンセル"}</SecondaryButton>
          <PrimaryButton onClick={() => void submit()} disabled={saving}>
            {saving ? "保存中…" : "変更を保存"}
          </PrimaryButton>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        {first && (
          <p className="rounded-[8px] bg-[#1D9BD11A] p-3 text-[15px] leading-relaxed">
            はじめに、コミュニティで表示する名前を設定してください。ご本名は他の会員には表示されません（運営のみ確認できます）。
          </p>
        )}
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1 space-y-5">
            <label className="block">
              <span className="mb-1.5 block text-[15px] font-bold">表示名</span>
              <input
                className={inputClass}
                value={name}
                maxLength={DISPLAY_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：ポニー好きのさくら"
                autoFocus
                required
              />
              <span className="mt-1 block text-[13px] text-sk-mute">
                ニックネームがおすすめです。「運営」「公式」など運営と紛らわしい名前は使えません。
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[15px] font-bold">自己紹介</span>
              <textarea
                className={textareaClass}
                rows={3}
                value={bio}
                maxLength={BIO_MAX}
                onChange={(e) => setBio(e.target.value)}
                placeholder="応援している馬、好きなことなど"
              />
            </label>
          </div>
          <div className="hidden sm:block text-center">
            <Avatar userId={me.id} size={120} />
            <Link href="/mypage/profile" className="mt-2 block text-[13px] text-sk-link hover:underline">
              写真を変更する
            </Link>
          </div>
        </div>
        {!me.isStaff && (
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={allowDm} onChange={(e) => setAllowDm(e.target.checked)} />
            <span>
              ほかの会員からのダイレクトメッセージを受け付ける
              <span className="block text-[13px] text-sk-mute">オフにしても、運営からのメッセージは届きます。</span>
            </span>
          </label>
        )}
        {error && <p className="text-[13px] font-bold text-[#E01E5A]">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// メンバーを選ぶ（チャンネル作成・メンバー追加）
// ---------------------------------------------------------------------------

function PeoplePicker({
  channelId,
  selected,
  onChange,
}: {
  channelId: string | null;
  selected: UserInfo[];
  onChange: (list: UserInfo[]) => void;
}) {
  const actions = useActions();
  const me = useMe();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const list = await api.inviteCandidates(actions.db, channelId, q);
        if (id !== seq.current) return;
        actions.mergeUsers(list);
        setRows(list);
      } catch {
        if (id === seq.current) setRows([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q, channelId, actions]);

  const toggle = (u: UserInfo) =>
    onChange(selected.some((s) => s.user_id === u.user_id) ? selected.filter((s) => s.user_id !== u.user_id) : [...selected, u]);

  return (
    <div>
      <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-[4px] border border-[#1D1C1D4D] px-1.5 py-1 focus-within:border-[#1D9BD1] focus-within:shadow-[0_0_0_1px_#1D9BD1,0_0_0_5px_rgba(29,155,209,0.3)]">
        {selected.map((u) => (
          <span key={u.user_id} className="flex h-7 items-center gap-1 rounded-[4px] bg-[#1D9BD11A] pl-0.5 pr-1 text-[13px] font-bold text-sk-link">
            <Avatar userId={u.user_id} size={22} />
            {u.display_name ?? "会員"}
            <button type="button" onClick={() => toggle(u)} aria-label={`${u.display_name} を外す`} className="rounded-[3px] hover:bg-[#1D9BD133]">
              <Icon name="close" className="w-3.5 h-3.5" strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={selected.length ? "" : me.isStaff ? "表示名・氏名で検索" : "表示名で検索"}
          className="h-7 min-w-[140px] flex-1 bg-transparent px-1.5 text-[15px] outline-none placeholder:text-[#1D1C1D80]"
          autoFocus
        />
      </div>
      <ul className="mt-2 max-h-[280px] overflow-y-auto">
        {loading && rows.length === 0 && <li className="px-2 py-3 text-[13px] text-sk-mute animate-pulse">検索中…</li>}
        {!loading && rows.length === 0 && <li className="px-2 py-3 text-[13px] text-sk-mute">該当するメンバーがいません。</li>}
        {rows.map((u) => {
          const on = selected.some((s) => s.user_id === u.user_id);
          return (
            <li key={u.user_id}>
              <button
                type="button"
                onClick={() => toggle(u)}
                className={`flex w-full items-center gap-3 rounded-[6px] px-2 py-1.5 text-left ${on ? "bg-[#1D9BD11A]" : "hover:bg-sk-soft"}`}
              >
                <Avatar userId={u.user_id} size={28} showOnline />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-bold">{u.display_name}</span>
                    {u.is_staff && <StaffTag />}
                  </span>
                  {me.isStaff && u.real_name && <span className="block truncate text-[12px] text-sk-mute">氏名: {u.real_name}</span>}
                </span>
                <span className={`flex h-5 w-5 items-center justify-center rounded-[4px] border ${on ? "border-sk-green bg-sk-green text-white" : "border-[#1D1C1D4D]"}`}>
                  {on && <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// チャンネルを作成する
// ---------------------------------------------------------------------------

function CreateChannelModal({ initialVisibility, onClose }: { initialVisibility?: "public" | "private"; onClose: () => void }) {
  const actions = useActions();
  const me = useMe();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">(initialVisibility ?? "public");
  const [staffOnly, setStaffOnly] = useState(false);
  const [autoJoin, setAutoJoin] = useState(false);
  const [members, setMembers] = useState<UserInfo[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const profileReady = me.isStaff || !!me.profile?.setup_done;
  const normalized = normalizeChannelName(name);
  const problem = channelNameProblem(name, me.isStaff);
  const everyone = me.isStaff && visibility === "public" && autoJoin;

  const create = async () => {
    setBusy(true);
    const id = await actions.createChannel({
      name,
      description,
      visibility,
      members: members.map((m) => m.user_id),
      postPolicy: me.isStaff && staffOnly ? "staff" : "everyone",
      autoJoin: everyone,
    });
    setBusy(false);
    if (id) onClose();
  };

  const next = () => {
    setTouched(true);
    if (problem) return;
    if (everyone) void create();
    else setStep(2);
  };

  if (!profileReady) {
    return (
      <Modal title="チャンネルを作成する" onClose={onClose} footer={<SecondaryButton onClick={onClose}>閉じる</SecondaryButton>}>
        <p className="text-[15px]">チャンネルを作成するには、先にコミュニティで表示する名前を設定してください。</p>
      </Modal>
    );
  }

  if (step === 2) {
    return (
      <Modal
        title={
          <span className="flex items-center gap-1.5">
            <span className="text-sk-mute">
              <Icon name={visibility === "private" ? "lock" : "hash"} className="w-5 h-5" strokeWidth={2.4} />
            </span>
            {normalized} にメンバーを追加する
          </span>
        }
        subtitle={visibility === "private" ? "非公開チャンネルは、追加したメンバーと運営だけが閲覧できます。" : "公開チャンネルは、会員なら誰でも見つけて参加できます。"}
        onClose={onClose}
        footer={
          <>
            <SecondaryButton onClick={() => setStep(1)} disabled={busy}>
              戻る
            </SecondaryButton>
            <PrimaryButton onClick={() => void create()} disabled={busy}>
              {busy ? "作成中…" : members.length > 0 ? `作成して${members.length}人を追加` : "スキップして作成"}
            </PrimaryButton>
          </>
        }
      >
        <PeoplePicker channelId={null} selected={members} onChange={setMembers} />
      </Modal>
    );
  }

  return (
    <Modal
      title="チャンネルを作成する"
      onClose={onClose}
      footer={
        <PrimaryButton onClick={next} disabled={busy || (touched && !!problem)}>
          {everyone ? (busy ? "作成中…" : "作成") : "次へ"}
        </PrimaryButton>
      }
    >
      <p className="mb-5 text-[15px] text-sk-mute">
        チャンネルでは、特定のトピックについて話し合えます。探しやすく、わかりやすい名前にしましょう。
      </p>
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[15px] font-bold">名前</span>
          <span className={`text-[13px] tabular-nums ${normalized.length > CHANNEL_NAME_LIMIT ? "text-[#E01E5A]" : "text-sk-mute"}`}>
            {CHANNEL_NAME_LIMIT - normalized.length}
          </span>
        </span>
        <span
          className={`flex h-10 items-center gap-1 rounded-[4px] border px-3 focus-within:shadow-[0_0_0_1px_#1D9BD1,0_0_0_5px_rgba(29,155,209,0.3)] ${
            touched && problem ? "border-[#E01E5A]" : "border-[#1D1C1D4D] focus-within:border-[#1D9BD1]"
          }`}
        >
          <span className="text-sk-mute">
            <Icon name={visibility === "private" ? "lock" : "hash"} className="w-4 h-4" strokeWidth={2.4} />
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name && setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                next();
              }
            }}
            placeholder="例：馬の写真部"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#1D1C1D80]"
            autoFocus
          />
        </span>
        {touched && problem ? (
          <span className="mt-1 block text-[13px] font-bold text-[#E01E5A]">{problem}</span>
        ) : normalized && normalized !== name.trim() ? (
          <span className="mt-1 block text-[13px] text-sk-mute">チャンネル名は「{normalized}」になります。</span>
        ) : null}
      </label>

      <label className="mt-5 block">
        <span className="mb-1.5 block text-[15px] font-bold">
          説明 <span className="font-normal text-sk-mute">（任意）</span>
        </span>
        <textarea
          className={textareaClass}
          rows={2}
          value={description}
          maxLength={CHANNEL_DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="このチャンネルについて"
        />
      </label>

      <fieldset className="mt-5">
        <legend className="mb-2 text-[15px] font-bold">表示レベル</legend>
        {(
          [
            ["public", "公開", "Retouch の会員なら誰でも見つけて参加できます"],
            ["private", "非公開", "招待されたメンバーだけが参加・閲覧できます"],
          ] as const
        ).map(([v, label, note]) => (
          <label key={v} className="flex cursor-pointer items-start gap-3 py-1.5">
            <input type="radio" name="visibility" className="mt-1 h-4 w-4" checked={visibility === v} onChange={() => setVisibility(v)} />
            <span>
              <span className="text-[15px] font-bold">{label}</span>
              <span className="text-[15px] text-sk-mute"> – {note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {me.isStaff && (
        <fieldset className="mt-4 space-y-2 rounded-[8px] border border-sk-line p-3">
          <legend className="px-1 text-[13px] font-bold text-sk-mute">運営向けの設定</legend>
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} />
            <span>
              運営だけが投稿できる（お知らせ・イベント用）
              <span className="block text-[13px] text-sk-mute">会員はスレッドでの返信とリアクションができます。</span>
            </span>
          </label>
          {visibility === "public" && (
            <label className="flex items-start gap-2 text-[15px]">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={autoJoin} onChange={(e) => setAutoJoin(e.target.checked)} />
              <span>
                全員を自動で参加させる
                <span className="block text-[13px] text-sk-mute">今の会員も、これから入会する会員も自動でメンバーになります。</span>
              </span>
            </label>
          )}
        </fieldset>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// メンバーを追加する
// ---------------------------------------------------------------------------

function InviteModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const actions = useActions();
  const ch = useChannel(channelId);
  const [selected, setSelected] = useState<UserInfo[]>([]);
  const [busy, setBusy] = useState(false);
  if (!ch) return null;
  return (
    <Modal
      title={
        <span className="flex items-center gap-1.5">
          <span className="text-sk-mute">
            <ChannelGlyph ch={ch} className="w-5 h-5" />
          </span>
          {ch.name} にメンバーを追加する
        </span>
      }
      onClose={onClose}
      footer={
        <PrimaryButton
          disabled={busy || selected.length === 0}
          onClick={async () => {
            setBusy(true);
            const ok = await actions.inviteMembers(
              channelId,
              selected.map((s) => s.user_id),
            );
            setBusy(false);
            if (ok) onClose();
          }}
        >
          {busy ? "追加中…" : "追加"}
        </PrimaryButton>
      }
    >
      <PeoplePicker channelId={channelId} selected={selected} onChange={setSelected} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 新しいメッセージ（DM の相手を探す）
// ---------------------------------------------------------------------------

function DirectoryModal({ onClose }: { onClose: () => void }) {
  const actions = useActions();
  const me = useMe();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const list = await api.directory(actions.db, q);
        if (id !== seq.current) return;
        actions.mergeUsers(list.filter((u) => u.display_name));
        setRows(list);
        setError(null);
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : "検索できませんでした。");
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q, actions]);

  return (
    <Modal title="新しいメッセージ" onClose={onClose}>
      <label className="flex h-10 items-center gap-2 rounded-[4px] border border-[#1D1C1D4D] px-3 focus-within:border-[#1D9BD1] focus-within:shadow-[0_0_0_1px_#1D9BD1,0_0_0_5px_rgba(29,155,209,0.3)]">
        <span className="text-[15px] text-sk-mute">宛先:</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#1D1C1D80]"
          placeholder={me.isStaff ? "表示名・氏名・フリガナ" : "表示名"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </label>
      <p className="mt-2 text-[13px] text-sk-mute">
        {me.isStaff
          ? "コミュニティを利用できる会員全員に送れます（表示名を未設定の方は氏名で表示）。"
          : "運営スタッフと、ダイレクトメッセージを受け付けている会員が表示されます。"}
      </p>
      {error && <p className="mt-2 text-[13px] font-bold text-[#E01E5A]">{error}</p>}
      <ul className="mt-2">
        {loading && rows.length === 0 && <li className="px-2 py-3 text-[13px] text-sk-mute animate-pulse">検索中…</li>}
        {!loading && rows.length === 0 && !error && <li className="px-2 py-3 text-[13px] text-sk-mute">該当するメンバーがいません。</li>}
        {rows.map((u) => (
          <li key={u.user_id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[6px] px-2 py-1.5 text-left hover:bg-sk-active hover:text-white group"
              onClick={async () => {
                onClose();
                await actions.startDm(u.user_id);
              }}
            >
              <Avatar userId={u.user_id} size={28} showOnline />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-bold">{u.display_name || u.real_name || "会員"}</span>
                  {u.user_id === me.id && <span className="text-[13px] opacity-70">（自分）</span>}
                  {u.is_staff && <StaffTag />}
                </span>
                {me.isStaff && u.real_name && u.real_name !== u.display_name && (
                  <span className="block truncate text-[12px] opacity-70">氏名: {u.real_name}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// チャンネル一覧
// ---------------------------------------------------------------------------

function BrowseRow({ ch, onClose }: { ch: ChannelRow; onClose: () => void }) {
  const actions = useActions();
  const me = useMe();
  const joinable = !ch.joined && !ch.is_archived && (ch.visibility === "public" || me.isStaff);
  return (
    <li className="group flex items-center gap-3 border-b border-sk-line px-1 py-3 last:border-b-0 hover:bg-sk-soft">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          onClose();
          actions.openChannel(ch.id);
        }}
      >
        <p className="flex items-center gap-1 text-[15px] font-black text-sk-text">
          <ChannelGlyph ch={ch} />
          <span className="truncate">{ch.name}</span>
        </p>
        <p className="mt-0.5 truncate text-[13px] text-sk-mute">
          {ch.joined && (
            <span className="font-bold text-sk-green">
              <Icon name="check" className="inline w-3.5 h-3.5 -mt-0.5" strokeWidth={3} /> 参加中
            </span>
          )}
          {ch.joined && "・"}
          {ch.member_count}人のメンバー
          {ch.description && `・${ch.description}`}
        </p>
      </button>
      <div className="flex shrink-0 gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100">
        <SecondaryButton
          className="!h-8 !px-3 !text-[13px]"
          onClick={() => {
            onClose();
            actions.openChannel(ch.id);
          }}
        >
          表示
        </SecondaryButton>
        {joinable && (
          <PrimaryButton
            className="!h-8 !px-3 !text-[13px]"
            onClick={async () => {
              await actions.join(ch.id);
              onClose();
              actions.openChannel(ch.id);
            }}
          >
            参加する
          </PrimaryButton>
        )}
      </div>
    </li>
  );
}

function BrowseModal({ onClose }: { onClose: () => void }) {
  const channels = useCS((s) => s.channels);
  const openModal = useOpenModal();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "joined" | "notJoined" | "archived">("all");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sortChannels(channels.filter((c) => c.kind === "channel"))
      .filter((c) => (filter === "archived" ? c.is_archived : !c.is_archived))
      .filter((c) => (filter === "joined" ? c.joined : filter === "notJoined" ? !c.joined : true))
      .filter((c) => !t || (c.name ?? "").toLowerCase().includes(t) || (c.description ?? "").toLowerCase().includes(t));
  }, [channels, q, filter]);

  return (
    <Modal
      title="チャンネル一覧"
      onClose={onClose}
      wide
      bodyClassName="px-7 pb-5"
    >
      <div className="flex gap-2">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-[4px] border border-[#1D1C1D4D] px-3 focus-within:border-[#1D9BD1] focus-within:shadow-[0_0_0_1px_#1D9BD1,0_0_0_5px_rgba(29,155,209,0.3)]">
          <Icon name="search" className="w-4 h-4 text-sk-mute" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#1D1C1D80]"
            placeholder="チャンネルを検索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </label>
        <PrimaryButton className="!h-10" onClick={() => openModal({ type: "create" })}>
          作成
        </PrimaryButton>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(
          [
            ["all", "すべて"],
            ["joined", "参加中"],
            ["notJoined", "未参加"],
            ["archived", "アーカイブ"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`h-7 rounded-[14px] border px-3 text-[13px] font-bold ${
              filter === k ? "border-sk-text bg-sk-text text-white" : "border-[#1D1C1D4D] text-sk-text hover:bg-sk-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-sk-mute">{list.length}件のチャンネル</p>
      <ul className="mt-1">
        {list.map((c) => (
          <BrowseRow key={c.id} ch={c} onClose={onClose} />
        ))}
        {list.length === 0 && <li className="py-8 text-center text-[15px] text-sk-mute">該当するチャンネルはありません。</li>}
      </ul>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// チャンネルの詳細（概要・メンバー・設定）
// ---------------------------------------------------------------------------

function InfoCard({
  label,
  value,
  onEdit,
  editing,
  editor,
}: {
  label: string;
  value: React.ReactNode;
  onEdit?: () => void;
  editing?: boolean;
  editor?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold">{label}</p>
        {onEdit && !editing && (
          <button type="button" onClick={onEdit} className="text-[13px] font-bold text-sk-link hover:underline">
            編集
          </button>
        )}
      </div>
      {editing ? editor : <div className="mt-0.5 text-[15px] text-sk-text">{value}</div>}
    </div>
  );
}

function InlineEditor({
  initial,
  max,
  multiline = false,
  onCancel,
  onSave,
  prefix,
}: {
  initial: string;
  max: number;
  multiline?: boolean;
  onCancel: () => void;
  onSave: (v: string) => Promise<boolean>;
  prefix?: React.ReactNode;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await onSave(v);
    setBusy(false);
    if (ok) onCancel();
  };
  return (
    <div className="mt-2 space-y-2">
      {multiline ? (
        <textarea className={textareaClass} rows={3} value={v} maxLength={max} onChange={(e) => setV(e.target.value)} autoFocus />
      ) : (
        <span className="flex h-10 items-center gap-1 rounded-[4px] border border-[#1D9BD1] px-3 shadow-[0_0_0_1px_#1D9BD1,0_0_0_5px_rgba(29,155,209,0.3)]">
          {prefix}
          <input
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            value={v}
            maxLength={max + 20}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void save();
              }
            }}
            autoFocus
          />
        </span>
      )}
      <div className="flex justify-end gap-2">
        <SecondaryButton className="!h-8 !text-[13px]" onClick={onCancel} disabled={busy}>
          キャンセル
        </SecondaryButton>
        <PrimaryButton className="!h-8 !text-[13px]" onClick={() => void save()} disabled={busy}>
          保存
        </PrimaryButton>
      </div>
    </div>
  );
}

function audienceText(ch: ChannelRow): string | null {
  if (ch.kind !== "channel" || ch.visibility === "private") return null;
  if (ch.audience === "plans") {
    const labels = ch.audience_plan_codes.map((c) => MEMBER_CODE_LABELS[c as MemberCode] ?? c).join("・");
    return `${labels}の方だけが参加しています（会員種別に応じて自動で参加・退出します）。`;
  }
  if (ch.audience === "supporters") return "支援者の方だけが参加しています（支援の開始・終了に応じて自動で参加・退出します）。";
  if (ch.audience === "staff") return "運営メンバーだけが参加しています。";
  return null;
}

function AboutTab({ ch, onClose }: { ch: ChannelRow; onClose: () => void }) {
  const actions = useActions();
  const creator = useName(ch.created_by);
  const [editing, setEditing] = useState<"name" | "topic" | "description" | null>(null);
  const canEditInfo = !ch.is_archived && (ch.can_manage || (ch.joined && ch.post_policy === "everyone"));
  const audience = audienceText(ch);
  return (
    <div className="space-y-4">
      <div className="divide-y divide-sk-line rounded-[8px] border border-sk-line">
        <InfoCard
          label="チャンネル名"
          value={
            <span className="flex items-center gap-1">
              <ChannelGlyph ch={ch} className="w-4 h-4" />
              {ch.name}
            </span>
          }
          onEdit={ch.can_manage && !ch.is_archived ? () => setEditing("name") : undefined}
          editing={editing === "name"}
          editor={
            <InlineEditor
              initial={ch.name ?? ""}
              max={CHANNEL_NAME_LIMIT}
              prefix={<ChannelGlyph ch={ch} className="w-4 h-4 text-sk-mute" />}
              onCancel={() => setEditing(null)}
              onSave={(v) => actions.updateChannel(ch.id, { name: v })}
            />
          }
        />
        <InfoCard
          label="トピック"
          value={ch.topic || <span className="text-sk-mute">トピックを追加</span>}
          onEdit={canEditInfo ? () => setEditing("topic") : undefined}
          editing={editing === "topic"}
          editor={
            <InlineEditor
              initial={ch.topic ?? ""}
              max={CHANNEL_TOPIC_MAX}
              onCancel={() => setEditing(null)}
              onSave={(v) => actions.updateChannel(ch.id, { topic: v })}
            />
          }
        />
        <InfoCard
          label="説明"
          value={ch.description ? <span className="whitespace-pre-wrap">{ch.description}</span> : <span className="text-sk-mute">説明を追加</span>}
          onEdit={canEditInfo ? () => setEditing("description") : undefined}
          editing={editing === "description"}
          editor={
            <InlineEditor
              initial={ch.description ?? ""}
              max={CHANNEL_DESCRIPTION_MAX}
              multiline
              onCancel={() => setEditing(null)}
              onSave={(v) => actions.updateChannel(ch.id, { description: v })}
            />
          }
        />
        <InfoCard
          label="作成者"
          value={
            <span className="text-sk-mute">
              {ch.created_by ? `${creator} さん` : "Retouch 運営"}（{formatDateTime(ch.created_at)}）
            </span>
          }
        />
        {audience && <InfoCard label="参加するメンバー" value={<span className="text-sk-mute">{audience}</span>} />}
        {ch.post_policy === "staff" && (
          <InfoCard label="投稿" value={<span className="text-sk-mute">運営のみ投稿できます（スレッドでの返信とリアクションは誰でもできます）。</span>} />
        )}
      </div>
      {ch.joined
        ? !ch.is_required && (
            <button
              type="button"
              className="w-full rounded-[8px] border border-sk-line px-4 py-3 text-left text-[15px] font-bold text-[#E01E5A] hover:bg-sk-soft"
              onClick={async () => {
                if (!window.confirm(`#${ch.name} から退出しますか？`)) return;
                onClose();
                await actions.leave(ch.id);
              }}
            >
              チャンネルから退出する
            </button>
          )
        : !ch.is_archived && (
            <PrimaryButton
              className="w-full"
              onClick={async () => {
                await actions.join(ch.id);
                onClose();
              }}
            >
              チャンネルに参加する
            </PrimaryButton>
          )}
    </div>
  );
}

function MemberRow({ userId, ch, canRemove }: { userId: string; ch: ChannelRow; canRemove: boolean }) {
  const actions = useActions();
  const openModal = useOpenModal();
  const name = useName(userId);
  const u = useUser(userId);
  const me = useMe();
  return (
    <li className="group flex items-center gap-3 rounded-[6px] px-2 py-1.5 hover:bg-sk-soft">
      <button type="button" onClick={() => openModal({ type: "user", userId })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar userId={userId} size={36} showOnline />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-bold">{name}</span>
            {userId === me.id && <span className="text-[13px] text-sk-mute">（自分）</span>}
            {u?.is_staff && <StaffTag />}
            {ch.created_by === userId && <span className="text-[12px] text-sk-mute">作成者</span>}
          </span>
          {me.isStaff && u?.real_name && u.real_name !== name && <span className="block truncate text-[12px] text-sk-mute">氏名: {u.real_name}</span>}
        </span>
      </button>
      {canRemove && userId !== me.id && (
        <button
          type="button"
          className="hidden text-[13px] font-bold text-sk-link hover:underline group-hover:block"
          onClick={async () => {
            if (!window.confirm(`${name} さんを #${ch.name} から外しますか？`)) return;
            await actions.removeMember(ch.id, userId);
          }}
        >
          削除
        </button>
      )}
    </li>
  );
}

function MembersTab({ ch }: { ch: ChannelRow }) {
  const actions = useActions();
  const openModal = useOpenModal();
  const members = useCS((s) => s.members[ch.id]);
  const users = useCS((s) => s.users);
  const [q, setQ] = useState("");
  useEffect(() => {
    void actions.loadMembers(ch.id);
  }, [actions, ch.id]);
  const ids = useMemo(() => {
    const t = q.trim();
    const list = members?.ids ?? [];
    return t ? list.filter((id) => (users[id]?.display_name ?? users[id]?.real_name ?? "").includes(t)) : list;
  }, [members?.ids, users, q]);
  const canAdd = !ch.is_archived && ch.joined && ch.audience === "all" && !(ch.visibility === "public" && ch.auto_join);
  const canRemove = ch.can_manage && ch.visibility === "private";
  const hidden = (members?.total ?? ch.member_count) - (members?.ids.length ?? 0);
  return (
    <div>
      <label className="flex h-10 items-center gap-2 rounded-[4px] border border-[#1D1C1D4D] px-3 focus-within:border-[#1D9BD1] focus-within:shadow-[0_0_0_1px_#1D9BD1,0_0_0_5px_rgba(29,155,209,0.3)]">
        <Icon name="search" className="w-4 h-4 text-sk-mute" />
        <input
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#1D1C1D80]"
          placeholder="メンバーを検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <ul className="mt-3">
        {canAdd && !q && (
          <li>
            <button
              type="button"
              onClick={() => openModal({ type: "invite", channelId: ch.id })}
              className="flex w-full items-center gap-3 rounded-[6px] px-2 py-1.5 text-left hover:bg-sk-soft"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#1D9BD11A] text-sk-link">
                <Icon name="userPlus" />
              </span>
              <span className="text-[15px] font-bold">メンバーを追加</span>
            </button>
          </li>
        )}
        {members?.loading && !members.ids.length && (
          <li className="px-2 py-3 text-[13px] text-sk-mute animate-pulse">読み込み中…</li>
        )}
        {ids.map((id) => (
          <MemberRow key={id} userId={id} ch={ch} canRemove={canRemove} />
        ))}
      </ul>
      {!q && hidden > 0 && members && !members.loading && (
        <p className="mt-3 px-2 text-[13px] text-sk-mute">ほか {hidden}人（表示名を設定していないメンバー）</p>
      )}
    </div>
  );
}

function SettingsTab({ ch, onClose }: { ch: ChannelRow; onClose: () => void }) {
  const actions = useActions();
  const me = useMe();
  return (
    <div className="space-y-4">
      {ch.joined && (
        <fieldset className="rounded-[8px] border border-sk-line p-4">
          <legend className="px-1 text-[15px] font-bold">通知</legend>
          {NOTIFY_LEVELS.map((l) => (
            <label key={l} className="flex cursor-pointer items-center gap-2 py-1 text-[15px]">
              <input type="radio" name="notify" className="h-4 w-4" checked={ch.notify === l} onChange={() => void actions.setNotify(ch.id, l)} />
              {NOTIFY_LABELS[l]}
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-2 py-1 text-[15px]">
            <input type="radio" name="notify" className="h-4 w-4" checked={ch.notify === null} onChange={() => void actions.setNotify(ch.id, "default")} />
            既定（{NOTIFY_LABELS[effectiveNotify({ ...ch, notify: null })]}）
          </label>
        </fieldset>
      )}
      <div className="divide-y divide-sk-line rounded-[8px] border border-sk-line">
        {(ch.joined || me.isStaff) && (
          <button
            type="button"
            onClick={() => void actions.toggleStar(ch.id)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-[15px] hover:bg-sk-soft"
          >
            <Icon name="star" className={`w-4 h-4 ${ch.is_starred ? "text-[#E8912D]" : ""}`} filled={ch.is_starred} />
            {ch.is_starred ? "スターを外す" : "スターを付ける"}
          </button>
        )}
        {ch.can_manage && !ch.is_required && (
          <button
            type="button"
            onClick={async () => {
              const archive = !ch.is_archived;
              if (archive && !window.confirm(`#${ch.name} をアーカイブしますか？\nメッセージは残り、閲覧のみになります。`)) return;
              const ok = await actions.archiveChannel(ch.id, archive);
              if (ok && archive) onClose();
            }}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-[15px] text-[#E01E5A] hover:bg-sk-soft"
          >
            <Icon name="archive" className="w-4 h-4" />
            {ch.is_archived ? "アーカイブを解除する" : "チャンネルをアーカイブする"}
          </button>
        )}
        {me.isStaff && (
          <Link
            href={`/admin/community/channels/${ch.id}`}
            className="flex w-full items-center gap-2 px-4 py-3 text-[15px] text-sk-link hover:bg-sk-soft"
          >
            <Icon name="settings" className="w-4 h-4" />
            管理画面で詳しく設定する（対象者・並び順など）
          </Link>
        )}
      </div>
    </div>
  );
}

function DetailsModal({ channelId, tab: initialTab, onClose }: { channelId: string; tab?: DetailsTab; onClose: () => void }) {
  const ch = useChannel(channelId);
  const [tab, setTab] = useState<DetailsTab>(initialTab ?? "about");
  if (!ch) return null;
  const tabs: [DetailsTab, string][] = [
    ["about", "概要"],
    ["members", `メンバー ${ch.member_count}`],
    ["settings", "設定"],
  ];
  return (
    <Modal
      title={
        <span className="flex items-center gap-1.5">
          <ChannelGlyph ch={ch} className="w-5 h-5" />
          {ch.name}
        </span>
      }
      onClose={onClose}
      bodyClassName="px-0 pb-5"
    >
      <div className="sticky top-0 z-[2] flex gap-5 border-b border-sk-line bg-white px-7" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`h-10 border-b-2 text-[13px] font-bold ${tab === k ? "border-sk-text text-sk-text" : "border-transparent text-sk-mute hover:text-sk-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="px-7 pt-5">
        {tab === "about" ? <AboutTab ch={ch} onClose={onClose} /> : tab === "members" ? <MembersTab ch={ch} /> : <SettingsTab ch={ch} onClose={onClose} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 検索
// ---------------------------------------------------------------------------

function SearchModal({ channelId, onClose }: { channelId: string | null; onClose: () => void }) {
  const actions = useActions();
  const nameOf = useNameOf();
  const channels = useCS((s) => s.channels);
  const me = useMe();
  const scoped = useChannel(channelId);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<string | null>(channelId);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await api.searchMessages(actions.db, q.trim(), scope);
      actions.ensureUsers(rows.map((r) => r.user_id));
      setHits(rows);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "検索できませんでした。");
    } finally {
      setLoading(false);
    }
  };

  const label = (cid: string) => {
    const c = channels.find((x) => x.id === cid);
    if (!c) return "";
    if (c.kind === "dm") return c.dm_user_id === me.id ? "自分用のメモ" : `${nameOf(c.dm_user_id)} とのDM`;
    return `#${c.name ?? ""}`;
  };

  return (
    <Modal title="検索" onClose={onClose} wide>
      <form onSubmit={run}>
        <label className="flex h-11 items-center gap-2 rounded-[8px] border border-[#1D9BD1] px-3 shadow-[0_0_0_1px_#1D9BD1,0_0_0_5px_rgba(29,155,209,0.3)]">
          <Icon name="search" className="w-5 h-5 text-sk-mute" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#1D1C1D80]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={scoped ? `${scoped.kind === "dm" ? "この会話" : `#${scoped.name}`} を検索` : "Retouch を検索"}
            autoFocus
            maxLength={100}
          />
          <PrimaryButton type="submit" className="!h-8 !px-3 !text-[13px]" disabled={loading || !q.trim()}>
            検索
          </PrimaryButton>
        </label>
      </form>
      {channelId && (
        <div className="mt-3 flex gap-1.5">
          {(
            [
              [channelId, scoped?.kind === "dm" ? "この会話" : "このチャンネル"],
              [null, "すべて"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setScope(v)}
              className={`h-7 rounded-[14px] border px-3 text-[13px] font-bold ${
                scope === v ? "border-sk-text bg-sk-text text-white" : "border-[#1D1C1D4D] hover:bg-sk-soft"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-[13px] font-bold text-[#E01E5A]">{error}</p>}
      {loading && <p className="mt-4 text-[13px] text-sk-mute animate-pulse">検索中…</p>}
      {!loading && searched && hits.length === 0 && <p className="mt-4 text-[15px] text-sk-mute">「{q}」に一致するメッセージはありません。</p>}
      {hits.length > 0 && <p className="mt-4 text-[13px] font-bold text-sk-mute">{hits.length}件のメッセージ</p>}
      <ul className="mt-2 space-y-2">
        {hits.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              className="flex w-full gap-3 rounded-[8px] border border-sk-line p-3 text-left hover:bg-sk-soft"
              onClick={() => {
                onClose();
                void actions.jumpTo(h);
              }}
            >
              <Avatar userId={h.user_id} size={36} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-black">{nameOf(h.user_id)}</span>
                  <span className="text-[12px] text-sk-mute">
                    {label(h.channel_id)}
                    {h.parent_id && "（スレッド）"}・{formatDateTime(h.created_at)}
                  </span>
                </span>
                <span className="text-[15px] text-sk-text line-clamp-2">{plainText(h.body, nameOf, 200)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hits.length >= 50 && <p className="mt-2 text-[13px] text-sk-mute">新しい順に50件まで表示しています。</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ピン留め
// ---------------------------------------------------------------------------

function PinnedModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const actions = useActions();
  const nameOf = useNameOf();
  const ch = useChannel(channelId);
  const [items, setItems] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .loadPinned(actions.db, channelId)
      .then((list) => {
        if (!active) return;
        actions.prepareMessages(list);
        setItems(list);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "読み込めませんでした。"));
    return () => {
      active = false;
    };
  }, [actions, channelId]);

  return (
    <Modal title="ピン留めアイテム" subtitle={ch?.kind === "channel" ? `#${ch.name}` : undefined} onClose={onClose} wide>
      {error && <p className="text-[13px] font-bold text-[#E01E5A]">{error}</p>}
      {!items && !error && <p className="text-[13px] text-sk-mute animate-pulse">読み込み中…</p>}
      {items && items.length === 0 && (
        <div className="py-8 text-center">
          <Icon name="pin" className="mx-auto w-8 h-8 text-sk-mute" />
          <p className="mt-3 text-[15px] font-bold">ピン留めされたメッセージはありません</p>
          <p className="mt-1 text-[13px] text-sk-mute">大事なメッセージは「その他」メニューからピン留めできます。</p>
        </div>
      )}
      <ul className="space-y-2">
        {(items ?? []).map((m) => (
          <li key={m.id} className="rounded-[8px] border border-sk-line p-3">
            <div className="mb-1 flex items-center gap-2">
              <Avatar userId={m.user_id} size={24} />
              <span className="text-[15px] font-black">{nameOf(m.user_id)}</span>
              <span className="text-[12px] text-sk-mute">{formatDateTime(m.created_at)}</span>
              <button
                type="button"
                className="ml-auto text-[13px] font-bold text-sk-link hover:underline"
                onClick={() => {
                  onClose();
                  void actions.jumpTo(m);
                }}
              >
                メッセージを表示
              </button>
            </div>
            {m.body ? <MessageBody body={m.body} /> : <p className="text-[13px] text-sk-mute">📎 添付ファイル</p>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 通報
// ---------------------------------------------------------------------------

function ReportModal({ message, onClose }: { message: Message; onClose: () => void }) {
  const actions = useActions();
  const nameOf = useNameOf();
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return;
    setSending(true);
    const ok = await actions.report(message, reason.trim());
    setSending(false);
    if (ok) onClose();
  };
  return (
    <Modal
      title="運営に通報する"
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>キャンセル</SecondaryButton>
          <button
            type="button"
            className="h-9 rounded-[4px] bg-[#E01E5A] px-4 text-[15px] font-bold text-white hover:bg-[#C71B50] disabled:opacity-50"
            disabled={sending || !reason.trim()}
            onClick={() => void submit()}
          >
            {sending ? "送信中…" : "通報する"}
          </button>
        </>
      }
    >
      <div className="rounded-[8px] border-l-4 border-sk-line bg-sk-soft p-3 text-[15px]">
        <p className="mb-1 text-[13px] font-bold">{nameOf(message.user_id)} さんのメッセージ</p>
        <p className="line-clamp-4 whitespace-pre-wrap">{plainText(message.body, nameOf, 400) || "（添付ファイル）"}</p>
      </div>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-[15px] font-bold">理由</span>
        <textarea
          className={textareaClass}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例：誹謗中傷にあたる内容です"
          autoFocus
        />
        <span className="mt-1 block text-[13px] text-sk-mute">通報内容は運営だけが確認します。相手に通知されることはありません。</span>
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ユーザーのプロフィール・既読
// ---------------------------------------------------------------------------

function UserModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const actions = useActions();
  const me = useMe();
  const u = useUser(userId);
  const name = useName(userId);
  const online = useOnline(userId);
  useEffect(() => actions.ensureUsers([userId]), [userId, actions]);
  const isMe = userId === me.id;
  const bio = isMe ? me.profile?.bio : u?.bio;
  return (
    <Modal title="プロフィール" onClose={onClose}>
      <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left sm:gap-5">
        <Avatar userId={userId} size={120} />
        <div className="mt-3 min-w-0 sm:mt-1">
          <p className="flex items-center justify-center gap-2 text-[22px] font-black sm:justify-start">
            <span className="truncate">{name}</span>
            {(u?.is_staff || (isMe && me.isStaff)) && <StaffTag />}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[15px] text-sk-mute sm:justify-start">
            <span className={`h-2.5 w-2.5 rounded-[999px] ${online ? "bg-sk-presence" : "border-2 border-sk-mute"}`} />
            {online ? "アクティブ" : "離席中"}
          </p>
          {me.isStaff && !isMe && (u?.real_name || u?.username) && (
            <p className="mt-2 text-[13px] text-sk-mute">
              {u?.real_name && <>氏名: {u.real_name}　</>}
              {u?.username && <>ユーザーネーム: {u.username}</>}
            </p>
          )}
          {bio && <p className="mt-3 whitespace-pre-wrap text-[15px]">{bio}</p>}
        </div>
      </div>
      {!isMe && (
        <div className="mt-5 flex justify-center sm:justify-start">
          <SecondaryButton
            className="flex items-center gap-1.5"
            onClick={async () => {
              onClose();
              await actions.startDm(userId);
            }}
          >
            <Icon name="dm" className="w-4 h-4" />
            メッセージを送る
          </SecondaryButton>
        </div>
      )}
    </Modal>
  );
}

function ReadersModal({ userIds, title, onClose }: { userIds: string[]; title: string; onClose: () => void }) {
  const actions = useActions();
  const nameOf = useNameOf();
  useEffect(() => actions.ensureUsers(userIds), [userIds, actions]);
  return (
    <Modal title={`${title}（${userIds.length}人）`} onClose={onClose}>
      <ul>
        {userIds.map((id) => (
          <li key={id} className="flex items-center gap-3 rounded-[6px] px-2 py-1.5 hover:bg-sk-soft">
            <Avatar userId={id} size={28} />
            <span className="text-[15px] font-bold">{nameOf(id)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** 開いているダイアログを1つ描画する。 */
export default function ModalHost() {
  const { modal, closeModal } = useUi();
  if (!modal) return null;
  switch (modal.type) {
    case "profile":
      return <ProfileModal onClose={closeModal} />;
    case "directory":
      return <DirectoryModal onClose={closeModal} />;
    case "browse":
      return <BrowseModal onClose={closeModal} />;
    case "create":
      return <CreateChannelModal initialVisibility={modal.visibility} onClose={closeModal} />;
    case "details":
      return <DetailsModal key={modal.channelId} channelId={modal.channelId} tab={modal.tab} onClose={closeModal} />;
    case "invite":
      return <InviteModal channelId={modal.channelId} onClose={closeModal} />;
    case "search":
      return <SearchModal channelId={modal.channelId} onClose={closeModal} />;
    case "pinned":
      return <PinnedModal channelId={modal.channelId} onClose={closeModal} />;
    case "report":
      return <ReportModal message={modal.message} onClose={closeModal} />;
    case "user":
      return <UserModal userId={modal.userId} onClose={closeModal} />;
    case "readers":
      return <ReadersModal userIds={modal.userIds} title={modal.title} onClose={closeModal} />;
    default:
      return null;
  }
}

