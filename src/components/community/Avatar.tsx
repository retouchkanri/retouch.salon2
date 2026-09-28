"use client";

import { memo } from "react";
import { PRESENCE_LABEL, useCS, useName, usePresence, type Presence } from "./store";

/** 在席状態の色（アクティブ = 緑 / 離席中 = 琥珀 / オフライン = 灰） */
export const PRESENCE_COLOR: Record<Presence, string> = {
  active: "#1FA35B",
  away: "#E9A23B",
  offline: "#A7B3AC",
};

/** 在席状態の丸（単体でも使う） */
export function PresenceDot({
  presence,
  size = 10,
  ring = "#FFFFFF",
  className = "",
}: {
  presence: Presence;
  size?: number;
  ring?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full transition-colors duration-300 ${className}`}
      style={{ width: size, height: size, background: PRESENCE_COLOR[presence], boxShadow: `0 0 0 2px ${ring}` }}
      title={PRESENCE_LABEL[presence]}
      aria-label={PRESENCE_LABEL[presence]}
    />
  );
}

/** 頭文字アイコンの背景色（ユーザーごとに固定。落ち着いた自然色の範囲） */
export function avatarHue(userId: string | null | undefined): number {
  let hash = 0;
  for (const c of userId ?? "") hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * ユーザーのアイコン（丸形）。未設定なら運営は運営アイコン、会員は頭文字。
 * showOnline で在席状態（アクティブ / 離席中 / オフライン）の丸を付ける。
 * solid を指定すると、写真があっても頭文字の単色アイコンで表示する。
 */
function AvatarInner({
  userId,
  size = 36,
  showOnline = false,
  ring = "white",
  solid = false,
  className = "",
}: {
  userId: string | null | undefined;
  size?: number;
  showOnline?: boolean;
  /** 在席表示の縁の色（背景に合わせる） */
  ring?: "white" | "side";
  solid?: boolean;
  className?: string;
}) {
  const info = useCS((s) => {
    if (!userId) return null;
    const u = s.users[userId];
    const isMe = userId === s.me.id;
    const url = (isMe ? s.me.profile?.avatar_url : null) ?? u?.avatar_url ?? null;
    const staff = u?.is_staff ?? (isMe && s.me.isStaff);
    return url || (staff ? "/avatars/admin.png" : "");
  });
  const name = useName(userId);
  const presence = usePresence(showOnline ? userId : null);
  const dot = Math.max(8, Math.round(size / 3.4));
  const hue = avatarHue(userId);
  const showImage = !!info && !solid;

  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={info!}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full rounded-full object-cover bg-white ring-1 ring-black/5"
        />
      ) : (
        <span
          className="w-full h-full rounded-full flex items-center justify-center text-white font-bold select-none"
          style={{
            fontSize: Math.max(10, Math.round(size * 0.42)),
            background: userId ? `hsl(${hue} 38% 40%)` : "#8A968F",
          }}
        >
          {userId ? name.trim().charAt(0) || "?" : "?"}
        </span>
      )}
      {showOnline && (
        <span className="absolute flex" style={{ right: -1, bottom: -1 }}>
          <PresenceDot presence={presence} size={dot} ring={ring === "side" ? "#F6F9F7" : "#FFFFFF"} />
        </span>
      )}
    </span>
  );
}

const Avatar = memo(AvatarInner);
export default Avatar;
