"use client";

import { useEffect, useRef, useState } from "react";

export type PickedCustomer = { id: string; full_name: string | null; email: string | null };

/** 顧客を氏名・フリガナ・メールで検索して複数選択する（既存の顧客検索 API を利用）。 */
export default function CustomerPicker({
  value,
  onChange,
}: {
  value: PickedCustomer[];
  onChange: (next: PickedCustomer[]) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(term)}&limit=20`);
        const j = await res.json().catch(() => ({}));
        if (id === seq.current) setResults(Array.isArray(j.results) ? j.results : []);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const selected = new Set(value.map((v) => v.id));

  return (
    <div className="space-y-2">
      <input className="input" placeholder="氏名・フリガナ・メールで検索" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && <p className="text-xs text-ink-mute">検索中…</p>}
      {results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded border border-surface-line divide-y divide-surface-line bg-white">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={selected.has(r.id)}
                onClick={() => onChange([...value, r])}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-soft disabled:opacity-50"
              >
                <span className="font-semibold">{r.full_name ?? "（氏名なし）"}</span>
                <span className="text-ink-mute ml-2">{r.email}</span>
                {selected.has(r.id) && <span className="ml-2 text-brand text-xs">選択済み</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand/30 px-2.5 py-1 text-xs">
              {v.full_name ?? v.email}
              <button
                type="button"
                className="text-ink-mute hover:text-danger"
                onClick={() => onChange(value.filter((x) => x.id !== v.id))}
                aria-label={`${v.full_name ?? v.email} を外す`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
