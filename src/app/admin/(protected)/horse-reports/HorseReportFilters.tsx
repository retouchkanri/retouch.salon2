"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type HorseOption = {
  id: string;
  label: string;
  search: string;
};

export default function HorseReportFilters({
  months,
  horses,
  ym,
  horseId,
}: {
  months: { value: string; label: string }[];
  horses: HorseOption[];
  ym: string;
  horseId: string;
}) {
  const router = useRouter();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = horses.find((horse) => horse.id === horseId) ?? horses[0] ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ja");
    if (!needle) return horses;
    return horses.filter((horse) => horse.search.toLocaleLowerCase("ja").includes(needle));
  }, [horses, query]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(nextHorseId: string, nextYm: string) {
    router.push(`/admin/horse-reports?horse=${encodeURIComponent(nextHorseId)}&ym=${encodeURIComponent(nextYm)}`);
  }

  return (
    <div className="no-print grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="font-medium">年月</span>
        <select
          className="input mt-1"
          value={ym}
          onChange={(event) => go(horseId, event.target.value)}
        >
          {months.map((month) => (
            <option key={month.value} value={month.value}>{month.label}</option>
          ))}
        </select>
      </label>
      <div ref={rootRef} className="relative text-sm">
        <span className="font-medium">馬</span>
        <button
          type="button"
          className="input mt-1 flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            setOpen((value) => !value);
            setQuery("");
          }}
        >
          <span className="min-w-0 truncate">{selected?.label ?? "馬を選択"}</span>
          <span aria-hidden className="text-ink-mute">▾</span>
        </button>
        {open ? (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-surface-line bg-white p-2 shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名前・番号・応募可能口数"
              className="input"
              aria-label="馬を検索"
            />
            <ul id={listId} role="listbox" className="mt-2 max-h-72 overflow-y-auto">
              {matches.length === 0 ? <li className="px-2 py-2 text-ink-soft">該当する馬はありません。</li> : matches.map((horse) => (
                <li key={horse.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={horse.id === horseId}
                    className={`w-full rounded-lg px-2 py-2 text-left leading-snug hover:bg-brand-50 ${horse.id === horseId ? "bg-brand-50 font-medium" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      go(horse.id, ym);
                    }}
                  >
                    {horse.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
