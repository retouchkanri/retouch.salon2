"use client";

import { useRef, useState } from "react";
import Avatar, { PresenceDot } from "./Avatar";
import { Icon } from "./icons";
import { Menu, MenuItem } from "./Sidebar";
import {
  PRESENCE_LABEL,
  PRESENCE_MODE_LABEL,
  useActions,
  useMe,
  useName,
  usePresence,
  usePresenceMode,
  type PresenceMode,
} from "./store";
import { useOpenModal } from "./ui";

const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const AVATAR_MAX = 5 * 1024 * 1024;

/** 在席状態の選択肢に出す丸の色 */
const MODE_DOT: Record<PresenceMode, "active" | "away" | "offline"> = {
  auto: "active",
  away: "away",
  invisible: "offline",
};

/**
 * ヘッダー右端のログイン中ユーザー（アイコン写真＋在席状態）。
 * アイコンはマイページの写真と同じ（未設定なら頭文字）。クリックでアカウントメニューを開き、
 * 在席状態の切り替え・写真の変更・プロフィール（表示名・自己紹介）の編集ができる。
 */
export default function UserMenu() {
  const me = useMe();
  const name = useName(me.id);
  const presence = usePresence(me.id);
  const mode = usePresenceMode();
  const actions = useActions();
  const openModal = useOpenModal();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!AVATAR_TYPES.includes(f.type)) {
      actions.pushToast({ kind: "error", title: "JPEG・PNG・WEBP・GIF の画像を選んでください。" });
      return;
    }
    if (f.size > AVATAR_MAX) {
      actions.pushToast({ kind: "error", title: "画像は5MB以内にしてください。" });
      return;
    }
    setUploading(true);
    await actions.uploadAvatar(f);
    setUploading(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded-full p-0.5 transition-transform duration-150 hover:scale-105 active:scale-95"
        aria-label={`${name}（${PRESENCE_LABEL[presence]}）のメニュー`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${name}・${PRESENCE_LABEL[presence]}`}
      >
        <Avatar userId={me.id} size={32} showOnline />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={AVATAR_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {open && (
        <Menu onClose={() => setOpen(false)} className="absolute right-0 top-11 w-[280px] origin-top-right">
          <div className="flex items-center gap-3 px-3 pb-3 pt-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group/av relative shrink-0 rounded-full"
              aria-label="写真を変更する"
              title="写真を変更する"
              disabled={uploading}
            >
              <Avatar userId={me.id} size={44} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover/av:opacity-100">
                {uploading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Icon name="edit" className="w-4 h-4" />
                )}
              </span>
            </button>
            <div className="min-w-0">
              <p className="font-bold truncate">{name}</p>
              <p className="flex items-center gap-1.5 text-[13px] text-sk-mute">
                <PresenceDot presence={presence} size={8} />
                {PRESENCE_LABEL[presence]}
              </p>
              {me.profile?.bio && <p className="mt-0.5 line-clamp-2 text-[12px] text-sk-mute">{me.profile.bio}</p>}
            </div>
          </div>

          <div className="my-1 border-t border-sk-line" />
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold tracking-[0.06em] text-[#7A877F]">在席状態</p>
          {(Object.keys(PRESENCE_MODE_LABEL) as PresenceMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={mode === m}
              onClick={() => actions.setPresenceMode(m)}
              className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-[#E3F0E8] ${
                mode === m ? "font-bold text-[#22553F]" : ""
              }`}
            >
              <PresenceDot presence={MODE_DOT[m]} size={9} ring="transparent" />
              <span className="flex-1">{PRESENCE_MODE_LABEL[m]}</span>
              {mode === m && <Icon name="check" className="w-4 h-4 text-[#2D6A4F]" strokeWidth={2.6} />}
            </button>
          ))}

          <div className="my-1 border-t border-sk-line" />
          <MenuItem
            icon="edit"
            onClick={() => {
              setOpen(false);
              openModal({ type: "profile" });
            }}
          >
            プロフィールを編集（名前・自己紹介）
          </MenuItem>
          <MenuItem
            icon="paperclip"
            onClick={() => {
              setOpen(false);
              fileRef.current?.click();
            }}
          >
            写真を変更する
          </MenuItem>
          <div className="my-1 border-t border-sk-line" />
          {me.isStaff && <MenuItem href="/admin/community">コミュニティ管理</MenuItem>}
          <MenuItem href={me.isStaff ? "/admin" : "/mypage"}>{me.isStaff ? "管理画面に戻る" : "マイページに戻る"}</MenuItem>
        </Menu>
      )}
    </div>
  );
}
