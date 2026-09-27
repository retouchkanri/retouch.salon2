"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  horseMeetingArrivalLabel,
  horseMeetingFacilityLabel,
  horseMeetingStatusLabel,
} from "@/lib/horseMeetings";
import { formatDate } from "@/lib/format";

export type HorseMeetingRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  applicant_name: string;
  facility: string;
  party_size: number;
  preferred_date: string;
  preferred_time_slot: string;
  supported_horses: string;
  arrival_method: string;
  pickup_time: string | null;
  note: string | null;
  status: string;
  admin_note: string | null;
  requested_at: string;
};

export default function HorseMeetingAdminRow({
  row,
  index,
}: {
  row: HorseMeetingRow;
  index: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(row.status);
  const [adminNote, setAdminNote] = useState(row.admin_note ?? "");
  const [editing, setEditing] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/horse-meetings/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, admin_note: adminNote || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "保存できませんでした");
      return;
    }
    setEditing(false);
    router.refresh();
  };

  const remove = async () => {
    if (!confirm("この申込を削除します。よろしいですか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/horse-meetings/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "削除できませんでした");
      return;
    }
    router.refresh();
  };

  return (
    <>
      <tr>
        <td className="text-right text-ink-mute tabular-nums">{index}</td>
        <td className="whitespace-nowrap">{formatDate(row.requested_at, true)}</td>
        <td>
          <div className="font-semibold">{row.applicant_name}</div>
          <div className="text-xs text-ink-mute">{row.customer_email}</div>
        </td>
        <td>
          <Link href={`/admin/customers/${row.customer_id}`} className="text-brand underline">
            {row.customer_name}
          </Link>
        </td>
        <td className="text-sm">{horseMeetingFacilityLabel(row.facility)}</td>
        <td className="whitespace-nowrap">
          {row.preferred_date}
          <br />
          <span className="text-xs text-ink-mute">{row.preferred_time_slot}</span>
        </td>
        <td>{row.party_size}</td>
        <td className="text-xs max-w-[180px] truncate" title={row.supported_horses}>
          {row.supported_horses}
        </td>
        <td className="text-xs max-w-[160px]">
          {horseMeetingArrivalLabel(row.arrival_method, row.pickup_time)}
        </td>
        <td>
          <select
            className="border border-surface-line rounded-lg bg-white px-2 py-1 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setEditing(true);
            }}
            disabled={busy}
          >
            <option value="pending">受付中</option>
            <option value="approved">承認済</option>
            <option value="completed">参加済</option>
            <option value="canceled">取消</option>
          </select>
        </td>
        <td className="text-right whitespace-nowrap col-actions">
          <button className="text-brand underline text-sm mr-2" onClick={() => setEditing((v) => !v)}>
            詳細
          </button>
          <button className="text-danger underline text-sm" onClick={remove} disabled={busy}>
            削除
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={11} className="bg-surface-soft">
            <div className="p-3 grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <p className="text-xs text-ink-mute">状態: {horseMeetingStatusLabel(status)}</p>
                {row.note && <p className="text-sm mt-1">その他: {row.note}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="label">管理メモ</label>
                <textarea
                  className="input min-h-[72px]"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button className="btn-primary" onClick={save} disabled={busy}>
                  保存
                </button>
                <button className="btn-ghost" onClick={() => setEditing(false)}>
                  閉じる
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
