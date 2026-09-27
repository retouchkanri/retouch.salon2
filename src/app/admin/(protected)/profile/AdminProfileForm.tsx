"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";

export default function AdminProfileForm({
  userId,
  email,
  avatarUrl,
  fullName,
  fullNameKana,
  phone,
}: {
  userId: string;
  email: string;
  avatarUrl: string | null;
  fullName: string;
  fullNameKana: string;
  phone: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    email,
    full_name: fullName,
    full_name_kana: fullNameKana,
    phone,
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatar, setAvatar] = useState<string | null>(avatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErr("画像は5MB以内にしてください");
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (password && password !== confirmPassword) {
      setErr("パスワードが一致しません。");
      return;
    }

    setBusy(true);

    // 1) Avatar upload
    if (avatarFile) {
      const fd = new FormData();
      fd.append("avatar", avatarFile);
      const res = await fetch("/api/mypage/avatar", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "アバターのアップロードに失敗しました。");
        setBusy(false);
        return;
      }
    }

    // 2) Update user via admin API
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        password: password || undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? "保存できませんでした。");
      return;
    }
    setMsg("保存しました。");
    setPassword("");
    setConfirmPassword("");
    setAvatarFile(null);
    router.refresh();
  };

  return (
    <form onSubmit={save} className="space-y-5">
      {/* Avatar */}
      <div className="card">
        <h2 className="text-base font-bold mb-4">プロフィール写真</h2>
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative group shrink-0"
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                className="w-20 h-20 rounded-full object-cover border-2 border-surface-line group-hover:border-brand transition-colors"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-surface-soft border-2 border-surface-line group-hover:border-brand transition-colors flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-mute">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
            )}
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </span>
          </button>
          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-brand underline text-sm font-medium"
            >
              写真を変更する
            </button>
            <p className="text-xs text-ink-mute mt-1">JPEG, PNG, WEBP, GIF（5MB以内）</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onAvatarChange}
          />
        </div>
      </div>

      {/* Basic info */}
      <div className="card space-y-4">
        <h2 className="text-base font-bold">基本情報</h2>
        <div>
          <label className="label">メールアドレス</label>
          <input type="email" className="input" value={form.email} onChange={set("email")} required />
        </div>
        <div>
          <label className="label">氏名</label>
          <input className="input" value={form.full_name} onChange={set("full_name")} required />
        </div>
        <div>
          <label className="label">フリガナ</label>
          <input className="input" value={form.full_name_kana} onChange={set("full_name_kana")} />
        </div>
        <div>
          <label className="label">電話番号</label>
          <input className="input" value={form.phone} onChange={set("phone")} />
        </div>
      </div>

      {/* Password */}
      <div className="card space-y-4">
        <h2 className="text-base font-bold">パスワード変更</h2>
        <p className="text-xs text-ink-mute">変更する場合のみ入力してください。</p>
        <div>
          <label className="label">新しいパスワード（8文字以上）</label>
          <PasswordInput
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            placeholder="新しいパスワードを入力"
          />
        </div>
        <div>
          <label className="label">パスワード確認</label>
          <PasswordInput
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            placeholder="もう一度入力してください"
          />
          {password && confirmPassword && password !== confirmPassword && (
            <p className="text-xs text-danger mt-1">パスワードが一致しません。</p>
          )}
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200">
          <p className="text-danger text-sm font-semibold">{err}</p>
        </div>
      )}
      {msg && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200">
          <p className="text-ok text-sm font-semibold">{msg}</p>
        </div>
      )}

      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "保存中..." : "保存する"}
      </button>
    </form>
  );
}
