"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** アイコンの値が画像か（アップロードした画像のパス。絵文字のアイコンは画像ではない）。 */
export function isChannelImage(icon: string | null | undefined): icon is string {
  return !!icon && (icon.startsWith("/uploads/") || /^https?:\/\//.test(icon));
}

/** 一覧などに出すチャンネルの画像（画像・絵文字・未設定）。 */
export function ChannelThumb({ icon, size = 32 }: { icon: string | null | undefined; size?: number }) {
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  if (isChannelImage(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" width={size} height={size} loading="lazy" className="shrink-0 object-cover" style={box} />;
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center bg-surface-soft text-ink-mute"
      style={{ ...box, fontSize: Math.round(size * 0.55) }}
    >
      {icon || "#"}
    </span>
  );
}

/**
 * チャンネルの画像をアップロードして変更する（管理画面のチャンネル編集用）。
 * 保存先と権限はコミュニティの画面と同じ API（/api/community/channels/[id]/icon）。
 */
export default function ChannelImage({ channelId, initialIcon, archived }: { channelId: string; initialIcon: string | null; archived: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const upload = async (file: File | undefined) => {
    setMsg(null);
    if (!file) return;
    if (!ALLOWED.includes(file.type)) return setMsg({ ok: false, text: "JPEG・PNG・WEBP・GIF の画像を選んでください。" });
    if (file.size > MAX_BYTES) return setMsg({ ok: false, text: "画像は2MB以内にしてください。" });
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/community/channels/${channelId}/icon`, { method: "POST", body: fd }).catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok || typeof j?.icon !== "string") {
      return setMsg({ ok: false, text: j?.error ?? "画像を保存できませんでした。" });
    }
    setIcon(j.icon);
    setMsg({ ok: true, text: "画像を変更しました。" });
    router.refresh();
  };

  const remove = async () => {
    if (!window.confirm("このチャンネルの画像を外しますか？（# または鍵のマークに戻ります）")) return;
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/community/channels/${channelId}/icon`, { method: "DELETE" }).catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) return setMsg({ ok: false, text: j?.error ?? "画像を外せませんでした。" });
    setIcon(null);
    setMsg({ ok: true, text: "画像を外しました。" });
    router.refresh();
  };

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-lg">チャンネルの画像</h2>
      <div className="flex flex-wrap items-center gap-4">
        <ChannelThumb icon={icon} size={72} />
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept={ALLOWED.join(",")}
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary !px-4 !py-2 text-sm" disabled={busy || archived} onClick={() => fileRef.current?.click()}>
              {busy ? "保存中…" : icon ? "画像を変更" : "画像をアップロード"}
            </button>
            {icon && (
              <button type="button" className="btn-secondary !px-4 !py-2 text-sm" disabled={busy || archived} onClick={() => void remove()}>
                画像を外す
              </button>
            )}
          </div>
          <p className="text-xs text-ink-mute">
            コミュニティの一覧とチャンネルの見出しに表示されます。正方形の画像がおすすめです（JPEG・PNG・WEBP・GIF、2MBまで）。選ぶとすぐに保存されます。
            {isChannelImage(icon) ? "" : icon ? ` いまは絵文字（${icon}）が設定されています。` : ""}
          </p>
          {archived && <p className="text-xs text-ink-mute">アーカイブしたチャンネルの画像は変更できません。</p>}
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-danger"}`}>{msg.text}</p>}
    </section>
  );
}
