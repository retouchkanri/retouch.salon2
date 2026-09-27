"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isStaffRole, toRole } from "@/lib/roles";

export default function LoginForm({ next }: { next: string }) {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        setError("メールアドレスかパスワードが正しくありません。");
        return;
      }

      // 多層防御: メール確認（本登録）が未完了の会員はログインさせない。
      // 通常は未確認ユーザーが signInWithPassword で弾かれるが、Supabase の
      // 「Confirm email」設定に依存しないよう registration_completed でも検査する。
      const { data: cust } = await supabase
        .from("customers")
        .select("registration_completed")
        .eq("auth_user_id", data.user.id)
        .maybeSingle();
      if (cust && (cust as { registration_completed?: boolean }).registration_completed === false) {
        await supabase.auth.signOut();
        setError(
          "メールに記載のリンクからアカウント作成（本登録）を完了してください。",
        );
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      const actual = toRole(profile?.role);
      const dest = isStaffRole(actual) ? "/admin" : next;
      startTransition(() => {
        router.replace(dest);
        router.refresh();
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3 sm:space-y-4">
      <div>
        <label className="label" htmlFor="email">
          メールアドレス
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="メールアドレスを入力してください"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          パスワード
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="パスワードを入力してください"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2 cursor-pointer text-ink-soft">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-surface-line text-brand focus:ring-brand/30"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>ログインしたままにする</span>
        </label>
        <Link href="/login/reset" className="text-brand underline shrink-0">
          パスワードをお忘れですか？
        </Link>
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={busy || isPending}>
        {busy || isPending ? "ログイン中..." : "ログイン"}
      </button>

      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-surface-line" />
        </div>
        <p className="relative text-center text-sm text-ink-mute">
          <span className="bg-white px-3">または</span>
        </p>
      </div>

      <Link
        href="/signup"
        className="btn w-full border border-surface-line bg-white text-brand font-semibold hover:bg-surface-soft text-center"
      >
        新規登録はこちら
      </Link>
    </form>
  );
}
