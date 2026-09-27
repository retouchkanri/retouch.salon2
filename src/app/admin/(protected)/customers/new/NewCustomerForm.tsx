"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Form = {
  full_name: string;
  full_name_kana: string;
  email: string;
  phone: string;
  birthday: string;
  gender: "male" | "female" | "other" | "unspecified";
  postal_code: string;
  address1: string;
  address2: string;
  status: "active" | "suspended" | "withdrawn";
};

const initialForm: Form = {
  full_name: "",
  full_name_kana: "",
  email: "",
  phone: "",
  birthday: "",
  gender: "unspecified",
  postal_code: "",
  address1: "",
  address2: "",
  status: "active",
};

export default function NewCustomerForm() {
  const router = useRouter();
  const [form, setForm] = useState<Form>(initialForm);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set =
    <K extends keyof Form>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value as Form[K] }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const payload = {
      full_name: form.full_name.trim(),
      full_name_kana: form.full_name_kana.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      birthday: form.birthday || null,
      gender: form.gender,
      postal_code: form.postal_code.trim() || null,
      address1: form.address1.trim() || null,
      address2: form.address2.trim() || null,
      status: form.status,
    };
    const res = await fetch("/api/admin/customers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setErr(j.error ?? "登録できませんでした。");
      return;
    }
    router.replace(`/admin/customers/${j.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={save} className="card space-y-4 max-w-xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">氏名 <span className="text-danger">*</span></label>
          <input className="input" value={form.full_name} onChange={set("full_name")} required />
        </div>
        <div>
          <label className="label">ニックネーム</label>
          <input className="input" value={form.full_name_kana} onChange={set("full_name_kana")} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">メール</label>
          <input type="email" className="input" value={form.email} onChange={set("email")} />
        </div>
        <div>
          <label className="label">電話番号</label>
          <input className="input" value={form.phone} onChange={set("phone")} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">生年月日</label>
          <input type="date" className="input" value={form.birthday} onChange={set("birthday")} />
        </div>
        <div>
          <label className="label">性別</label>
          <select className="input" value={form.gender} onChange={set("gender")}>
            <option value="unspecified">未指定</option>
            <option value="male">男性</option>
            <option value="female">女性</option>
            <option value="other">その他</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">郵便番号</label>
        <input className="input" value={form.postal_code} onChange={set("postal_code")} placeholder="例: 150-0001" />
      </div>
      <div>
        <label className="label">住所 1</label>
        <input className="input" value={form.address1} onChange={set("address1")} placeholder="都道府県・市区町村" />
      </div>
      <div>
        <label className="label">住所 2</label>
        <input className="input" value={form.address2} onChange={set("address2")} placeholder="番地・建物名" />
      </div>
      <div>
        <label className="label">状態</label>
        <select className="input" value={form.status} onChange={set("status")}>
          <option value="active">有効</option>
          <option value="suspended">停止中</option>
          <option value="withdrawn">退会</option>
        </select>
      </div>
      {err && <p className="text-danger text-sm">{err}</p>}
      <button className="btn-primary" disabled={saving}>
        {saving ? "登録中..." : "登録する"}
      </button>
    </form>
  );
}
