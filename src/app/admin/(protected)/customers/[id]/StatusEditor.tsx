"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StatusEditor({
  customerId,
  initialStatus,
}: {
  customerId: string;
  initialStatus: "active" | "suspended" | "withdrawn";
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);

  const change = async (v: typeof status) => {
    setSaving(true);
    const res = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: v }),
    });
    setSaving(false);
    if (res.ok) {
      setStatus(v);
      router.refresh();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-soft">会員状態</span>
      <select
        className="input !py-2"
        value={status}
        onChange={(e) => change(e.target.value as any)}
        disabled={saving}
      >
        <option value="active">有効</option>
        <option value="suspended">停止中</option>
        <option value="withdrawn">退会</option>
      </select>
    </div>
  );
}
