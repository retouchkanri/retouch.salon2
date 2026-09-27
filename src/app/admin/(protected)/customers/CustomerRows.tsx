"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CustomerDeleteButton from "./CustomerDeleteButton";

export type SortableKey = "kana" | "email" | "class" | "monthly" | "pay" | "status";

export type CustomerRow = {
  customer_id: string;
  index: number;
  full_name: string;
  email: string | null;
  classLabel: string;
  supportLabel: string;
  hasSpecial: boolean;
  rptActive: boolean;
  teamNames: string[];
  monthlyLabel: string;
  contractStatusLabel: string;
  contractStatusChipClass: string;
  memberStatusLabel: string;
  eligibleFree: boolean;
};

function SortHeader({
  label,
  sortKey,
  href,
  active,
  dir,
}: {
  label: string;
  sortKey: SortableKey;
  href: string;
  active: boolean;
  dir: "asc" | "desc";
}) {
  return (
    <th>
      <Link href={href} className="hover:underline whitespace-nowrap">
        {label}
        {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
      </Link>
    </th>
  );
}

export default function CustomerRows({
  rows,
  sortLinks,
  activeSort,
  activeDir,
}: {
  rows: CustomerRow[];
  sortLinks: Record<SortableKey, string>;
  activeSort: SortableKey | null;
  activeDir: "asc" | "desc";
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const eligibleRows = rows.filter((r) => r.eligibleFree);
  const allEligibleSelected =
    eligibleRows.length > 0 && eligibleRows.every((r) => selected.has(r.customer_id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allEligibleSelected ? new Set() : new Set(eligibleRows.map((r) => r.customer_id)));
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !confirm(
        `選択した無料会員 ${ids.length}件を完全に削除します。\n契約・一口支援・予約・面会申込・管理メモなど、各顧客に紐づく全てのデータも削除され、元に戻せません。\n本当によろしいですか？`
      )
    )
      return;
    setBusy(true);
    const res = await fetch("/api/admin/customers/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setSelected(new Set());
      if (j.skipped > 0) {
        alert(
          `${j.deleted ?? 0}件を削除しました。\n${j.skipped}件は、確認時点ですでに無料会員ではなくなっていたためスキップしました。`
        );
      }
      router.refresh();
    } else {
      alert(j.error ?? "削除に失敗しました。");
    }
  };

  return (
    <div className="card p-0 overflow-auto">
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-amber-50 border-b border-surface-line">
          <span className="text-sm">無料会員 {selected.size}件を選択中</span>
          <button onClick={bulkDelete} disabled={busy} className="text-red-600 underline text-sm disabled:opacity-50">
            {busy ? "削除中..." : "選択した会員をまとめて削除"}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-ink-mute underline text-sm">
            選択解除
          </button>
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th className="w-8">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={allEligibleSelected}
                onChange={toggleAll}
                disabled={eligibleRows.length === 0}
                title="このページの空白（無料）会員をすべて選択"
              />
            </th>
            <th className="w-12 text-right">No.</th>
            <SortHeader label="氏名" sortKey="kana" href={sortLinks.kana} active={activeSort === "kana"} dir={activeDir} />
            <SortHeader label="メール" sortKey="email" href={sortLinks.email} active={activeSort === "email"} dir={activeDir} />
            <SortHeader label="会員種別" sortKey="class" href={sortLinks.class} active={activeSort === "class"} dir={activeDir} />
            <th>支援数</th>
            <th>特別参加</th>
            <SortHeader label="月額" sortKey="monthly" href={sortLinks.monthly} active={activeSort === "monthly"} dir={activeDir} />
            <SortHeader label="決済状態" sortKey="pay" href={sortLinks.pay} active={activeSort === "pay"} dir={activeDir} />
            <SortHeader label="状態" sortKey="status" href={sortLinks.status} active={activeSort === "status"} dir={activeDir} />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customer_id} className="hover:bg-surface-soft">
              <td>
                {r.eligibleFree && (
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={selected.has(r.customer_id)}
                    onChange={() => toggle(r.customer_id)}
                    title="無料会員（プラン未加入）"
                  />
                )}
              </td>
              <td className="text-right text-ink-mute tabular-nums">{r.index}</td>
              <td className="font-semibold">{r.full_name}</td>
              <td>{r.email ?? "—"}</td>
              <td>{r.classLabel}</td>
              <td className="whitespace-nowrap">{r.supportLabel}</td>
              <td>
                {r.hasSpecial ? (
                  <span className="flex flex-wrap gap-1">
                    {r.rptActive && <span className="chip-mute">リタポ</span>}
                    {r.teamNames.map((name) => (
                      <span key={name} className="chip-mute">{name}</span>
                    ))}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td>{r.monthlyLabel}</td>
              <td>
                <span className={r.contractStatusChipClass}>{r.contractStatusLabel}</span>
              </td>
              <td>{r.memberStatusLabel}</td>
              <td className="text-right whitespace-nowrap">
                <Link href={`/admin/customers/${r.customer_id}`} className="text-brand underline">詳細</Link>
                <span className="mx-1 text-ink-mute">|</span>
                <CustomerDeleteButton id={r.customer_id} name={r.full_name ?? "この顧客"} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={11} className="text-center text-ink-mute py-6">該当する顧客がいません。</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
