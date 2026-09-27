"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Match = { id: string; full_name: string; full_name_kana: string | null; email: string | null };

export default function AddBookingForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [picked, setPicked] = useState<Match | null>(null);
  const [partySize, setPartySize] = useState("1");
  const [note, setNote] = useState("");
  const [bypass, setBypass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (picked) return;
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(query)}`);
      const j = await res.json().catch(() => ({}));
      setMatches(Array.isArray(j.results) ? j.results : []);
    }, 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, picked]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) {
      setMsg("顧客を選択してください。");
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: picked.id,
        event_id: eventId,
        party_size: Number(partySize),
        note: note || null,
        bypass_guard: bypass || undefined,
      }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "登録できませんでした。");
      return;
    }
    setMsg("追加しました。");
    setQuery("");
    setPicked(null);
    setNote("");
    setPartySize("1");
    setBypass(false);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="grid sm:grid-cols-4 gap-3">
      <div className="sm:col-span-2 relative">
        <label className="label">顧客を検索</label>
        {picked ? (
          <div className="flex items-center gap-2">
            <span className="chip-ok flex-1 truncate">
              {picked.full_name}{picked.email ? ` <${picked.email}>` : ""}
            </span>
            <button
              type="button"
              className="text-brand underline text-sm"
              onClick={() => setPicked(null)}
            >
              変更
            </button>
          </div>
        ) : (
          <>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="氏名・カナ・メールで検索"
            />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border-2 border-surface-line rounded-xl max-h-56 overflow-auto shadow-lg">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-surface-soft text-sm"
                      onClick={() => {
                        setPicked(m);
                        setQuery("");
                        setMatches([]);
                      }}
                    >
                      <span className="font-semibold">{m.full_name}</span>{" "}
                      <span className="text-ink-mute">{m.email ?? ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div>
        <label className="label">人数</label>
        <input
          type="number"
          className="input"
          min={1}
          max={20}
          value={partySize}
          onChange={(e) => setPartySize(e.target.value)}
        />
      </div>
      <div>
        <label className="label">メモ</label>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 sm:col-span-4 text-sm">
        <input
          type="checkbox"
          className="w-5 h-5"
          checked={bypass}
          onChange={(e) => setBypass(e.target.checked)}
        />
        <span>定員・支援者条件を無視して強制的に登録する（管理者）</span>
      </label>
      {msg && <p className="sm:col-span-4 text-sm">{msg}</p>}
      <div className="sm:col-span-4">
        <button className="btn-primary" disabled={busy}>
          {busy ? "登録中..." : "予約を追加"}
        </button>
      </div>
    </form>
  );
}
