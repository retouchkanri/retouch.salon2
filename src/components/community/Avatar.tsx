"use client";

import { memo } from "react";
import { useCS, useName, useOnline } from "./store";

/**
 * ユーザーのアイコン（Slack と同じ角丸の正方形）。未設定なら運営は運営アイコン、会員は頭文字。
 * showOnline でオンライン表示（緑の丸 / 白抜きの丸）を付ける。
 */
function AvatarInner({
  userId,
  size = 36,
  showOnline = false,
  ring = "white",
  className = "",
}: {
  userId: string | null | undefined;
  size?: number;
  showOnline?: boolean;
  /** オンライン表示の縁の色（背景に合わせる） */
  ring?: "white" | "side";
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
  const isOnline = useOnline(showOnline ? userId : null);
  const radius = size <= 20 ? 4 : size <= 28 ? 6 : 8;
  const dot = Math.max(8, Math.round(size / 3.2));
  let hash = 0;
  for (const c of userId ?? "") hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;

  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      {info ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={info}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover bg-white"
          style={{ borderRadius: radius }}
        />
      ) : (
        <span
          className="w-full h-full flex items-center justify-center text-white font-bold select-none"
          style={{
            borderRadius: radius,
            fontSize: Math.max(10, Math.round(size * 0.45)),
            background: userId ? `hsl(${hue} 45% 42%)` : "#868686",
          }}
        >
          {userId ? name.trim().charAt(0) || "?" : "?"}
        </span>
      )}
      {showOnline && (
        <span
          className={`absolute rounded-[999px] border-2 ${ring === "side" ? "border-sk-side" : "border-white"} ${
            isOnline ? "bg-sk-presence" : ring === "side" ? "bg-sk-side" : "bg-white"
          }`}
          style={{ width: dot, height: dot, right: -3, bottom: -3 }}
          title={isOnline ? "アクティブ" : "離席中"}
        >
          {!isOnline && (
            <span
              className={`absolute inset-[1px] rounded-[999px] border ${ring === "side" ? "border-white/60" : "border-sk-mute"}`}
            />
          )}
        </span>
      )}
    </span>
  );
}

const Avatar = memo(AvatarInner);
export default Avatar;
