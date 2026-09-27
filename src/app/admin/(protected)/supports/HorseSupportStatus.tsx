"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import horsePortrait from "@/assets/images/horse-portrait.jpg";

export type HorseStatusItem = {
  id: string;
  name: string;
  image_url: string | null;
  /** 例: "支援者 12名 / 9.5口 / ¥114,000月" */
  stats: string;
};

// ── アイコン ──
function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 6.5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function HorseSupportStatus({
  items,
  canManage,
}: {
  items: HorseStatusItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<
    null | { mode: "create" | "edit"; horse?: { id: string; name: string; image_url: string | null } }
  >(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleDelete(item: HorseStatusItem) {
    if (!window.confirm(`「${item.name}」を削除しますか？この操作は元に戻せません。`)) return;
    setDeletingId(item.id);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/admin/horses/${item.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "削除に失敗しました。");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="section-title mb-0">馬ごとの支援状況</h2>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
              setEditing({ mode: "create" });
            }}
            className="inline-flex items-center gap-1 rounded-full bg-brand text-white px-4 py-2 text-sm font-bold shadow-sm hover:bg-brand-dark active:scale-95 transition-all"
          >
            ＋ 新規
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {notice && <p className="mb-3 text-sm text-brand-dark">{notice}</p>}

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
        {items.map((s) => (
          <div
            key={s.id}
            className="group relative p-3 rounded-xl border border-surface-line flex items-center gap-3 transition-colors hover:border-brand/40 hover:bg-brand-50/40"
          >
            {s.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.image_url} alt={s.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-brand-50 overflow-hidden shrink-0">
                <Image src={horsePortrait} alt={s.name} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold truncate">{s.name}</p>
              <p className="text-xs text-ink-soft">{s.stats}</p>
            </div>

            {/* Hover edit / delete icons */}
            {canManage && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setEditing({ mode: "edit", horse: { id: s.id, name: s.name, image_url: s.image_url } });
                  }}
                  aria-label={`${s.name}を編集`}
                  title="編集"
                  className="w-7 h-7 rounded-full bg-white/95 shadow border border-surface-line flex items-center justify-center text-ink-soft hover:text-brand hover:border-brand transition-colors"
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(s)}
                  disabled={deletingId === s.id}
                  aria-label={`${s.name}を削除`}
                  title="削除"
                  className="w-7 h-7 rounded-full bg-white/95 shadow border border-surface-line flex items-center justify-center text-ink-soft hover:text-danger hover:border-danger transition-colors disabled:opacity-50"
                >
                  <TrashIcon />
                </button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-ink-mute py-4 col-span-full text-center">
            有効な支援がある馬はまだありません。
          </p>
        )}
      </div>

      {editing && (
        <HorseEditModal
          mode={editing.mode}
          horse={editing.horse}
          onClose={() => setEditing(null)}
          onSaved={(mode, name) => {
            setEditing(null);
            if (mode === "create") {
              setNotice(`「${name}」を登録しました。支援が登録されると一覧に表示されます。`);
            }
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function HorseEditModal({
  mode,
  horse,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  horse?: { id: string; name: string; image_url: string | null };
  onClose: () => void;
  onSaved: (mode: "create" | "edit", name: string) => void;
}) {
  const [name, setName] = useState(horse?.name ?? "");
  const [imageUrl, setImageUrl] = useState(horse?.image_url ?? "");
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr(null);
    setOk(null);
    try {
      // 1) ストレージへアップロードして公開URLを取得
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/horses/image", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) {
        setErr(j.error ?? "アップロードに失敗しました。");
        return;
      }
      setImageUrl(j.url);

      // 2) 既存の馬なら、アップロード画像を即座にデータベース（horses.image_url）へ保存。
      //    「保存する」を押し忘れても確実にDBへ反映される。
      if (mode === "edit" && horse?.id) {
        const patch = await fetch(`/api/admin/horses/${horse.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image_url: j.url }),
        });
        if (!patch.ok) {
          const pj = await patch.json().catch(() => ({}));
          setErr(pj.error ?? "画像のデータベース保存に失敗しました。");
          return;
        }
        setOk("画像をデータベースに保存しました。");
      } else {
        setOk("画像をアップロードしました。「保存する」で確定します。");
      }
    } catch {
      setErr("通信エラーが発生しました。もう一度お試しください。");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("馬名を入力してください。");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const url = mode === "create" ? "/api/admin/horses" : `/api/admin/horses/${horse!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), image_url: imageUrl.trim() || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "保存に失敗しました。");
        return;
      }
      onSaved(mode, name.trim());
    } catch {
      setErr("通信エラーが発生しました。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (active: boolean) =>
    `px-3 py-1 text-sm rounded-md transition-colors ${
      active ? "bg-white text-brand-dark font-bold shadow-sm" : "text-ink-mute hover:text-ink"
    }`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 animate-[scaleIn_180ms_ease] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{mode === "create" ? "馬を新規登録" : "馬を編集"}</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-ink-mute hover:text-ink">
            <XIcon />
          </button>
        </div>

        <form onSubmit={save} className="space-y-4">
          {/* 画像プレビュー */}
          <div className="flex justify-center">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="w-28 h-28 rounded-xl object-cover border border-surface-line" />
            ) : (
              <div className="w-28 h-28 rounded-xl bg-surface-soft border border-dashed border-surface-line flex items-center justify-center text-ink-mute text-xs">
                画像なし
              </div>
            )}
          </div>

          <div>
            <label className="label">馬名（文字）</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div>
            <label className="label">画像</label>
            <div className="inline-flex rounded-lg border border-surface-line bg-surface-soft p-0.5 mb-2">
              <button type="button" onClick={() => setTab("url")} className={tabBtn(tab === "url")}>
                URLで指定
              </button>
              <button type="button" onClick={() => setTab("upload")} className={tabBtn(tab === "upload")}>
                アップロード
              </button>
            </div>

            {tab === "url" ? (
              <input
                type="url"
                className="input"
                placeholder="https://..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            ) : (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={onPickFile}
                  className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:text-white file:font-semibold hover:file:bg-brand-dark"
                />
                {uploading && <p className="text-xs text-ink-mute mt-1">アップロード中...</p>}
                <p className="text-xs text-ink-mute mt-1">JPEG / PNG / WEBP / GIF・5MBまで</p>
              </div>
            )}

            {imageUrl && (
              <button type="button" onClick={() => setImageUrl("")} className="text-xs text-ink-mute underline mt-2">
                画像をクリア
              </button>
            )}
          </div>

          {err && <p className="text-sm text-danger">{err}</p>}
          {ok && <p className="text-sm text-brand-dark">{ok}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-full text-ink-soft hover:bg-surface-soft">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={busy || uploading}
              className="inline-flex items-center rounded-full bg-brand text-white px-5 py-2 text-sm font-bold shadow-sm hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-50"
            >
              {busy ? "保存中..." : "保存する"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
