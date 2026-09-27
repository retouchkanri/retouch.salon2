"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveAvatarUrl } from "@/lib/avatars";
import { ROLE_LABELS_JP, toRole, type Role } from "@/lib/roles";
import PasswordInput from "@/components/PasswordInput";

type Initial = {
  email: string;
  full_name: string;
  full_name_kana: string;
  phone: string;
  status: string;
  role: string;
  avatar_url: string | null;
};

export default function UserEditForm({
  userId,
  initial,
  assignableRoles,
}: {
  userId: string;
  initial: Initial;
  assignableRoles: Role[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set =
    (k: keyof Initial) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, password: password || undefined }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? "保存できませんでした。");
      return;
    }
    setMsg("保存しました。");
    setPassword("");
    router.refresh();
  };

  const remove = async () => {
    if (!confirm("このユーザーを削除します。よろしいですか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "削除できませんでした。");
      return;
    }
    router.replace("/admin/users");
    router.refresh();
  };

  const displayAvatar = resolveAvatarUrl(toRole(form.role), form.avatar_url);

  return (
    <form onSubmit={save} className="card space-y-4">
      <div className="flex items-center gap-3">
        {displayAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayAvatar}
            alt=""
            className="w-16 h-16 rounded-full object-cover border border-surface-line"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-surface-soft border border-surface-line" />
        )}
        <p className="text-sm text-ink-mute">ID: {userId}</p>
      </div>
      <div>
        <label className="label">メールアドレス</label>
        <input type="email" className="input" value={form.email} onChange={set("email")} required />
      </div>
      <div>
        <label className="label">氏名</label>
        <input className="input" value={form.full_name} onChange={set("full_name")} />
      </div>
      <div>
        <label className="label">ニックネーム</label>
        <input className="input" value={form.full_name_kana} onChange={set("full_name_kana")} />
      </div>
      <div>
        <label className="label">電話</label>
        <input className="input" value={form.phone} onChange={set("phone")} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">権限</label>
          <select className="input" value={form.role} onChange={set("role")}>
            {/* Keep the current role visible even if the actor can't normally assign it. */}
            {(assignableRoles.includes(form.role as Role)
              ? assignableRoles
              : [form.role as Role, ...assignableRoles]
            ).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS_JP[r] ?? r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">会員状態</label>
          <select className="input" value={form.status} onChange={set("status")}>
            <option value="active">有効</option>
            <option value="suspended">停止中</option>
            <option value="withdrawn">退会</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">パスワード変更（任意・8文字以上）</label>
        <PasswordInput
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          placeholder="変更する場合のみ入力"
        />
      </div>
      {err && <p className="text-danger text-sm">{err}</p>}
      {msg && <p className="text-ok text-sm">{msg}</p>}
      <div className="flex gap-2 items-center">
        <button className="btn-primary" disabled={busy}>
          {busy ? "保存中..." : "保存する"}
        </button>
        <button type="button" className="btn-danger" disabled={busy} onClick={remove}>
          削除
        </button>
      </div>
    </form>
  );
}
