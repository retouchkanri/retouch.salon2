"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FOLLOW_REASONS, type FollowReason, type FollowUp } from "@/lib/followUp";
import { formatYen } from "@/lib/format";

const LABELS = Object.fromEntries(FOLLOW_REASONS.map((reason) => [reason.key, reason.label])) as Record<FollowReason, string>;

export default function FollowUpBoard({ rows }: { rows: FollowUp[] }) {
  const [reason, setReason] = useState<FollowReason | "all">("all");
  const [copied, setCopied] = useState<string | null>(null);
  const shown = useMemo(
    () => (reason === "all" ? rows : rows.filter((row) => row.reasons.includes(reason))),
    [reason, rows],
  );

  async function copyGuide(row: FollowUp) {
    const text = [
      `${row.name} 様`,
      "",
      "いつもRetouchの活動へのご支援をありがとうございます。",
      "継続のご支援について、お支払いの確認が必要な状態です。お手数ですが、マイページからカード情報をご確認ください。",
      "",
      "https://retouch.salon/mypage",
      "",
      "Retouchメンバーズ事務局",
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(row.customerId);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        <button type="button" className={`rounded-full px-3 py-1 text-xs ${reason === "all" ? "bg-brand text-white" : "bg-white"}`} onClick={() => setReason("all")}>すべて {rows.length}</button>
        {FOLLOW_REASONS.map((item) => {
          const count = rows.filter((row) => row.reasons.includes(item.key)).length;
          return (
            <button key={item.key} type="button" className={`rounded-full px-3 py-1 text-xs ${reason === item.key ? "bg-brand text-white" : "bg-white"}`} onClick={() => setReason(item.key)}>
              {item.label} {count}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? <p className="card text-sm text-ink-soft">該当する会員はいません。</p> : (
        <ul className="space-y-2">
          {shown.map((row) => (
            <li key={row.customerId} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/admin/customers/${row.customerId}`} className="font-bold text-brand underline">{row.name}</Link>
                  {row.email ? <p className="text-xs text-ink-soft">{row.email}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {row.reasons.map((key) => (
                      <span key={key} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-800">{LABELS[key]}</span>
                    ))}
                  </div>
                  <p className="mt-2 text-sm">{row.detail}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums">{formatYen(row.monthlyYen)} / 月</p>
                  <p className="text-xs text-ink-soft">年間にすると {formatYen(row.annualYen)}</p>
                  <button type="button" className="btn-secondary mt-2" onClick={() => void copyGuide(row)}>
                    {copied === row.customerId ? "コピーしました" : "更新案内をコピー"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
