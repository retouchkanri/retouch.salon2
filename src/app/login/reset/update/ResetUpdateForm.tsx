"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import PasswordInput from "@/components/PasswordInput";

export default function ResetUpdateForm() {
  const supabase = getSupabaseBrowserClient();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The email link lands here. Establish the recovery session from the URL:
  //  - token_hash 方式（アプリ送信の日本語メール）: verifyOtp で確立。PKCE の
  //    verifier が不要なため、別のブラウザ／メールアプリ内ブラウザで開いても成功する。
  //  - 既存セッションがあればそのまま利用。
  //  - PKCE（?code=）: 後方互換。申込時と同じブラウザで exchangeCodeForSession。
  useEffect(() => {
    let active = true;
    (async () => {
      if (active) setCurrentUrl(window.location.href);
      try {
        const params = new URLSearchParams(window.location.search);
        const tokenHash = params.get("token_hash");
        const type = params.get("type");
        const code = params.get("code");

        if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as EmailOtpType,
          });
          if (active) {
            if (error)
              setLinkError(
                "リンクが無効か、有効期限が切れています。お手数ですが再度お試しください。",
              );
            else setReady(true);
            setChecking(false);
          }
          return;
        }

        const { data: s } = await supabase.auth.getSession();
        if (s.session) {
          if (active) {
            setReady(true);
            setChecking(false);
          }
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (active) {
            if (error)
              setLinkError(
                "リンクが無効か、有効期限が切れています。お手数ですが再度お試しください。",
              );
            else setReady(true);
            setChecking(false);
          }
          return;
        }

        if (active) {
          setLinkError("無効なアクセスです。パスワード再設定メールのリンクから開いてください。");
          setChecking(false);
        }
      } catch {
        if (active) {
          setLinkError("確認に失敗しました。お手数ですが再度お試しください。");
          setChecking(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }
    if (password !== confirm) {
      setError("パスワードが一致しません。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError("更新に失敗しました。再度お試しください。");
        return;
      }
      await supabase.auth.signOut();
      setDone(true);
    } catch {
      setError("通信エラーが発生しました。再度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return <p className="text-sm text-ink-soft text-center py-4">確認中...</p>;
  }
  if (done) {
    return (
      <div className="text-center">
        <p className="text-brand-dark font-bold mb-2">パスワードを変更しました。</p>
        <p className="text-ink-soft text-sm">新しいパスワードでログインしてください。</p>
        <Link href="/login" className="mt-5 inline-block text-brand underline text-sm">
          ログインへ進む
        </Link>
      </div>
    );
  }
  if (linkError) {
    return (
      <div className="text-center">
        <p className="text-danger text-sm mb-4 leading-relaxed">{linkError}</p>
        {currentUrl && (
          <div className="mb-4 text-left">
            <p className="text-xs text-ink-soft leading-relaxed mb-1">
              うまく開けない場合は、下のURLをコピーして、パスワード再設定を申し込んだ
              ブラウザのアドレスバーに貼り付けて開いてください。
            </p>
            <CopyUrlBox url={currentUrl} />
          </div>
        )}
        <Link href="/login/reset" className="text-brand underline text-sm">
          再設定メールを送り直す
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink-soft">新しいパスワードを設定してください。</p>
      <div>
        <label className="label" htmlFor="new-pass">新しいパスワード（8文字以上）</label>
        <PasswordInput
          id="new-pass"
          required
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="new-pass2">新しいパスワード（確認）</label>
        <PasswordInput
          id="new-pass2"
          required
          autoComplete="new-password"
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy || !ready}>
        {busy ? "更新中..." : "パスワードを変更"}
      </button>
    </form>
  );
}

/** 完全なURLを表示し、ワンタップでコピーできるボックス。 */
function CopyUrlBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    } catch {
      // クリップボードAPIが使えない環境向けのフォールバック。
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* noop */
      }
      document.body.removeChild(ta);
    }
  };
  return (
    <div className="rounded-xl border-2 border-surface-line bg-surface-soft p-2">
      <p className="text-xs break-all font-mono text-ink-soft mb-2">{url}</p>
      <button type="button" onClick={copy} className="btn-ghost !py-1.5 !px-3 w-full text-sm">
        {copied ? "コピーしました ✓" : "URLをコピー"}
      </button>
    </div>
  );
}
