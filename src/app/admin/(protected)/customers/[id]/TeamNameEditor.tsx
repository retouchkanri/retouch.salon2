"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TeamNameEditor({
  membershipId,
  initialName,
}: {
  membershipId: string;
  initialName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== (initialName ?? "").trim();

  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/admin/special-team/${membershipId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ team_name: name.trim() || null }),
    });
    setSaving(false);
    if (res.ok) router.refresh();
  };

  return (
    <div className="flex items-center gap-1">
      <input
        className="input !py-1 !px-2 text-sm w-44"
        value={name}
        placeholder="チーム名（未入力可）"
        onChange={(e) => setName(e.target.value)}
        disabled={saving}
      />
      {dirty && (
        <button
          type="button"
          className="btn-primary !py-1 !px-2 text-xs whitespace-nowrap"
          onClick={save}
          disabled={saving}
        >
          {saving ? "保存中" : "保存"}
        </button>
      )}
    </div>
  );
}
