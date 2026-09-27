"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Initial = {
  full_name: string | null;
  full_name_kana: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  gender: "male" | "female" | "other" | "unspecified" | null;
  postal_code: string | null;
  address1: string | null;
  address2: string | null;
};

const GENDER_LABEL: Record<NonNullable<Initial["gender"]>, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  unspecified: "未指定",
};

export default function InfoEditor({
  customerId,
  initial,
}: {
  customerId: string;
  initial: Initial;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Initial>({
    full_name: initial.full_name ?? "",
    full_name_kana: initial.full_name_kana ?? "",
    email: initial.email ?? "",
    phone: initial.phone ?? "",
    birthday: initial.birthday ?? "",
    gender: initial.gender ?? "unspecified",
    postal_code: initial.postal_code ?? "",
    address1: initial.address1 ?? "",
    address2: initial.address2 ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set =
    <K extends keyof Initial>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value as Initial[K] }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const payload = {
      full_name: (form.full_name ?? "").trim() || undefined,
      full_name_kana: (form.full_name_kana ?? "").trim() || null,
      email: (form.email ?? "").trim() || undefined,
      phone: (form.phone ?? "").trim() || null,
      birthday: form.birthday || null,
      gender: form.gender ?? "unspecified",
      postal_code: (form.postal_code ?? "").trim() || null,
      address1: (form.address1 ?? "").trim() || null,
      address2: (form.address2 ?? "").trim() || null,
    };
    const res = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setErr(j.error ?? "保存できませんでした。");
      return;
    }
    setEditing(false);
    router.refresh();
  };

  if (!editing) {
    return (
      <>
        <dl className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <Row label="氏名" value={initial.full_name} />
          <Row label="ニックネーム" value={initial.full_name_kana} />
          <Row label="メール" value={initial.email} />
          <Row label="電話" value={initial.phone} />
          <Row label="生年月日" value={initial.birthday} />
          <Row label="性別" value={initial.gender ? GENDER_LABEL[initial.gender] : null} />
          <div className="flex justify-between py-1.5 border-b border-surface-line md:col-span-2">
            <dt className="text-ink-soft">住所</dt>
            <dd className="text-right">
              {initial.postal_code ? `〒${initial.postal_code} ` : ""}
              {initial.address1 ?? ""}
              {initial.address2 ? ` ${initial.address2}` : ""}
              {!initial.address1 && !initial.postal_code && "—"}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-secondary !py-2 !px-4 text-sm"
          >
            基本情報を編集
          </button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="氏名" required>
          <input className="input" value={form.full_name ?? ""} onChange={set("full_name")} required />
        </Field>
        <Field label="ニックネーム">
          <input className="input" value={form.full_name_kana ?? ""} onChange={set("full_name_kana")} />
        </Field>
        <Field label="メール">
          <input type="email" className="input" value={form.email ?? ""} onChange={set("email")} />
        </Field>
        <Field label="電話番号">
          <input className="input" value={form.phone ?? ""} onChange={set("phone")} />
        </Field>
        <Field label="生年月日">
          <input type="date" className="input" value={form.birthday ?? ""} onChange={set("birthday")} />
        </Field>
        <Field label="性別">
          <select className="input" value={form.gender ?? "unspecified"} onChange={set("gender")}>
            <option value="unspecified">未指定</option>
            <option value="male">男性</option>
            <option value="female">女性</option>
            <option value="other">その他</option>
          </select>
        </Field>
        <Field label="郵便番号">
          <input className="input" value={form.postal_code ?? ""} onChange={set("postal_code")} placeholder="例: 150-0001" />
        </Field>
        <Field label="住所 1">
          <input className="input" value={form.address1 ?? ""} onChange={set("address1")} placeholder="都道府県・市区町村" />
        </Field>
        <Field label="住所 2">
          <input className="input" value={form.address2 ?? ""} onChange={set("address2")} placeholder="番地・建物名" />
        </Field>
      </div>

      {err && <p className="text-danger text-sm">{err}</p>}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          className="btn-ghost !py-2 !px-4 text-sm"
          onClick={() => {
            setEditing(false);
            setErr(null);
          }}
          disabled={saving}
        >
          キャンセル
        </button>
        <button className="btn-primary !py-2 !px-4 text-sm" disabled={saving}>
          {saving ? "保存中..." : "保存する"}
        </button>
      </div>
      <p className="text-[11px] text-ink-mute">
        変更内容は監査ログ（customer.update）に記録されます。
      </p>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-surface-line">
      <dt className="text-ink-soft">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
