"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS_JP, type Role } from "@/lib/roles";
import PasswordInput from "@/components/PasswordInput";

export default function NewUserForm({ assignableRoles }: { assignableRoles: Role[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    role: (assignableRoles.includes("member") ? "member" : assignableRoles[0]) as Role,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? "登録できませんでした。");
      return;
    }
    router.replace(`/admin/users/${j.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div>
        <label className="label">メールアドレス</label>
        <input type="email" className="input" value={form.email} onChange={set("email")} required />
      </div>
      <div>
        <label className="label">パスワード（8文字以上）</label>
        <PasswordInput
          autoComplete="new-password"
          value={form.password}
          onChange={set("password")}
          minLength={8}
          required
        />
      </div>
      <div>
        <label className="label">氏名</label>
        <input className="input" value={form.full_name} onChange={set("full_name")} required />
      </div>
      <div>
        <label className="label">権限</label>
        <select className="input" value={form.role} onChange={set("role")}>
          {assignableRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS_JP[r]}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="text-danger text-sm">{err}</p>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "登録中..." : "登録する"}
      </button>
    </form>
  );
}
