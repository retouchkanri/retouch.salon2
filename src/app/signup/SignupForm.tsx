"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import PasswordInput, { EmailInput } from "@/components/PasswordInput";

export default function SignupForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 送信完了後に表示する「仮会員登録完了」モーダルの対象メール。
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("画像は5MB以内にしてください");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError("画像はJPEG/PNG/WEBP/GIFのいずれかをご利用ください");
      return;
    }
    setError(null);
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("パスワードが一致しません。確認用と同じパスワードを入力してください。");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("email", email);
      fd.append("password", password);
      if (avatarFile) fd.append("avatar", avatarFile);

      const res = await fetch("/api/auth/registration/start", {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "登録に失敗しました。");
        return;
      }
      setSentTo(email);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={onSubmit} className={`space-y-3 sm:space-y-4${sentTo ? " hidden" : ""}`}>
      <p className="text-center text-sm font-semibold text-ink-soft">新規会員登録</p>


      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative group shrink-0"
          aria-label="プロフィール写真を選択する"
        >
          {avatarPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarPreview}
              alt=""
              className="w-16 h-16 object-cover border-2 border-surface-line group-hover:border-brand transition-colors [border-radius:50%]"
            />
          ) : (
            <div className="w-16 h-16 bg-surface-soft border-2 border-surface-line group-hover:border-brand transition-colors flex items-center justify-center [border-radius:50%]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-mute">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity [border-radius:50%]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={onAvatarChange}
        />
      </div>

      <div>
        <label className="label" htmlFor="email">
          メールアドレス
        </label>
        <EmailInput
          id="email"
          name="email"
          autoComplete="email"
          required
          placeholder="メールアドレスを入力してください"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          パスワード（8文字以上）
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          showLockIcon
          placeholder="パスワードを入力してください"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">
          パスワード（確認）
        </label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={8}
          showLockIcon
          placeholder="確認のためもう一度入力してください"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </div>

      <p className="text-center text-xs">
        <Link href="/guide" className="text-brand underline">
          ご入会のご案内（会員制度・特典）を読む
        </Link>
      </p>

      {error && <p className="text-danger text-sm">{error}</p>}

      <button className="btn-primary w-full" type="submit" disabled={loading}>
        {loading ? "送信中..." : "確認メールを送信する"}
      </button>

      <p className="text-center text-xs text-ink-mute">
        ご入力のメール宛に確認リンクをお送りします。リンクからアカウント作成へお進みください。
      </p>

      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-surface-line" />
        </div>
        <p className="relative text-center text-sm text-ink-mute">
          <span className="bg-white px-3">または</span>
        </p>
      </div>

      <Link
        href="/login"
        className="btn w-full border border-surface-line bg-white text-brand font-semibold hover:bg-surface-soft text-center"
      >
        ログインはこちら
      </Link>
      </form>

      {sentTo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="仮会員登録完了"
        >
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-xl">
            <h2 className="text-center text-xl font-bold text-brand mb-4">仮会員登録完了</h2>
            <div className="text-center text-sm text-ink-soft leading-relaxed space-y-3">
              <p>
                <span className="font-semibold text-ink break-all">{sentTo}</span>
                <br />へメールを送信しました。
              </p>
              <p>登録メールが届かない場合は、迷惑メールフォルダをご確認ください。</p>
              <p>
                メールよりアカウント作成ページに進みいただき、
                <br />
                会員登録を続けてください。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="btn-primary w-full mt-6"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  );
}
