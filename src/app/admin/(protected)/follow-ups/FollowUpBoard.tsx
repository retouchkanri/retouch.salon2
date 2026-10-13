"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  FOLLOW_REASONS,
  MARK_RETRY_DAYS,
  followStatus,
  followUpRiskYen,
  splitFollowUps,
  type FollowMark,
  type FollowReason,
  type FollowStatus,
  type FollowUp,
} from "@/lib/followUp";
import { formatDate, formatYen } from "@/lib/format";

const LABELS = Object.fromEntries(FOLLOW_REASONS.map((reason) => [reason.key, reason.label])) as Record<FollowReason, string>;

const TABS: { key: FollowStatus; label: string; empty: string }[] = [
  { key: "open", label: "未対応", empty: "未対応の会員はいません。" },
  { key: "done", label: "済", empty: "「済」にした会員はいません。" },
  { key: "dismissed", label: "削除済み", empty: "削除した会員はいません。" },
];

export default function FollowUpBoard({ rows, marks: initialMarks }: { rows: FollowUp[]; marks: FollowMark[] }) {
  const [marks, setMarks] = useState(() => new Map(initialMarks.map((mark) => [mark.customerId, mark])));
  const [tab, setTab] = useState<FollowStatus>("open");
  const [reason, setReason] = useState<FollowReason | "all">("all");
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const states = useMemo(
    () => new Map(rows.map((row) => [row.customerId, followStatus(row, marks.get(row.customerId))])),
    [rows, marks],
  );
  const byStatus = useMemo(() => splitFollowUps(rows, marks), [rows, marks]);
  const inTab = byStatus[tab];
  const shown = useMemo(
    () => (reason === "all" ? inTab : inTab.filter((row) => row.reasons.includes(reason))),
    [reason, inTab],
  );
  const risk = followUpRiskYen(byStatus.open);
  const marked = byStatus.done.length + byStatus.dismissed.length;

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

  // 印は一覧の表示だけを変える。顧客・契約・決済のデータは変わらない。
  async function setMark(row: FollowUp, state: "done" | "dismissed" | "open") {
    setBusy(row.customerId);
    setError(null);
    try {
      const res = await fetch("/api/admin/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: row.customerId, state, reasons: row.reasons }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; mark?: FollowMark | null; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "保存に失敗しました。");
      setMarks((prev) => {
        const next = new Map(prev);
        if (json.mark) next.set(row.customerId, json.mark);
        else next.delete(row.customerId);
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <section className="card">
        <p className="text-sm">
          対象 {byStatus.open.length}名。いま関係している月額は {formatYen(risk.monthly)} で、このまま途切れると年間 {formatYen(risk.annual)} です。
          {marked > 0 ? <span className="text-ink-soft">（済 {byStatus.done.length}名・削除 {byStatus.dismissed.length}名は含みません）</span> : null}
        </p>
        <p className="mt-1 text-xs text-ink-mute">たとえば月額3,600円の方が10名そのまま離れると、年間では43万円を超えます。案内文はお一人ずつコピーして送れます。</p>
        <p className="mt-1 text-xs text-ink-mute">
          連絡などの対応が済んだ方は「済にする」、一覧に出す必要のない方は「削除」を押すと、未対応から外れます（顧客や契約のデータは変わりません。いつでも元に戻せます）。
          印をつけたあとに、新しい理由が加わったとき、支援の停止があったとき、{MARK_RETRY_DAYS}日を過ぎてから決済失敗があったときは、もう一度「未対応」に戻ります。
        </p>
      </section>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="対応の状態">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === item.key ? "bg-ink text-white" : "bg-white text-ink-soft"}`}
            onClick={() => setTab(item.key)}
          >
            {item.label} {byStatus[item.key].length}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <button type="button" className={`rounded-full px-3 py-1 text-xs ${reason === "all" ? "bg-brand text-white" : "bg-white"}`} onClick={() => setReason("all")}>すべて {inTab.length}</button>
        {FOLLOW_REASONS.map((item) => {
          const count = inTab.filter((row) => row.reasons.includes(item.key)).length;
          return (
            <button key={item.key} type="button" className={`rounded-full px-3 py-1 text-xs ${reason === item.key ? "bg-brand text-white" : "bg-white"}`} onClick={() => setReason(item.key)}>
              {item.label} {count}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="card text-sm text-ink-soft">{inTab.length === 0 ? TABS.find((item) => item.key === tab)!.empty : "該当する会員はいません。"}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((row) => {
            const mark = marks.get(row.customerId);
            const state = states.get(row.customerId) ?? { status: "open" as FollowStatus, renewed: false };
            const waiting = busy === row.customerId;
            return (
              <li key={row.customerId} className={`card ${state.status === "open" ? "" : "bg-surface-soft/60"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/customers/${row.customerId}`} className="font-bold text-brand underline">{row.name}</Link>
                      {state.status === "done" ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-900">済</span> : null}
                      {state.status === "dismissed" ? <span className="rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-bold text-ink-soft">削除</span> : null}
                    </div>
                    {row.email ? <p className="text-xs text-ink-soft">{row.email}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {row.reasons.map((key) => (
                        <span key={key} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-800">{LABELS[key]}</span>
                      ))}
                    </div>
                    <p className="mt-2 text-sm">{row.detail}</p>
                    {state.status !== "open" && mark ? (
                      <p className="mt-1 text-xs text-ink-mute">{formatDate(mark.at, true)} に「{mark.state === "done" ? "済" : "削除"}」にしました。</p>
                    ) : null}
                    {state.renewed && mark ? (
                      <p className="mt-1 text-xs text-amber-800">
                        {formatDate(mark.at, true)} に「{mark.state === "done" ? "済" : "削除"}」にしましたが、そのあと新しい動きがあったため、未対応に戻しています。
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums">{formatYen(row.monthlyYen)} / 月</p>
                    <p className="text-xs text-ink-soft">年間にすると {formatYen(row.annualYen)}</p>
                    <button type="button" className="btn-secondary mt-2" onClick={() => void copyGuide(row)}>
                      {copied === row.customerId ? "コピーしました" : "更新案内をコピー"}
                    </button>
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      {state.status === "open" ? (
                        <>
                          <button type="button" disabled={waiting} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" onClick={() => void setMark(row, "done")}>
                            済にする
                          </button>
                          <button type="button" disabled={waiting} className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-50" onClick={() => void setMark(row, "dismissed")}>
                            削除
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" disabled={waiting} className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-50" onClick={() => void setMark(row, "open")}>
                            {state.status === "done" ? "未対応に戻す" : "元に戻す"}
                          </button>
                          {state.status === "done" ? (
                            <button type="button" disabled={waiting} className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-bold text-ink-soft disabled:opacity-50" onClick={() => void setMark(row, "dismissed")}>
                              削除
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
