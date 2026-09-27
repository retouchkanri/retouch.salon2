"use client";

import { useState } from "react";
import Link from "next/link";

export default function ResetRequestForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // アプリ独自の日本語メール（/api/auth/password-reset）で送信する。
      // Supabase の英語デフォルトメールは使わない。
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "送信に失敗しました。時間をおいて再度お試しください。");
        return;
      }
      setSent(true);
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center">
        <p className="text-brand-dark font-bold mb-2">メールを送信しました。</p>
        <p className="text-ink-soft text-sm leading-relaxed">
          パスワード再設定用のリンクを
          <span className="font-semibold break-all">「{email}」</span>
          宛にお送りしました。メール内のリンクから新しいパスワードを設定してください。
          <br />
          メールが届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
        <Link href="/login" className="mt-5 inline-block text-brand underline text-sm">
          ログインへ戻る
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink-soft leading-relaxed">
        ご登録のメールアドレスを入力してください。パスワード再設定用のリンクをお送りします。
      </p>
      <div>
        <label className="label" htmlFor="reset-email">メールアドレス</label>
        <input
          id="reset-email"
          type="email"
          required
          autoComplete="email"
          className="input"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "送信中..." : "再設定メールを送信"}
      </button>
    </form>
  );
}
