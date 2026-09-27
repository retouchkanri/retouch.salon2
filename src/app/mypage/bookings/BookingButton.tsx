"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_COMPANIONS,
  PICKUP_NONE,
  PICKUP_OPTIONS,
  RELATION_OPTIONS,
  ridingAvailable,
  type Relation,
  type Venue,
} from "@/lib/events";
import type { BookingCompanion } from "@/types/db";

export default function BookingButton({
  eventId,
  disabled,
  cancel,
  edit,
  visit = false,
  venue = null,
  initialPartySize,
  initialNote,
  initialPickup,
  initialRiding,
  initialCompanions,
  maxPartySize = 20,
}: {
  eventId: string;
  disabled?: boolean;
  cancel?: boolean;
  edit?: boolean;
  /** 見学会（visit）かどうか。true のとき送迎・同伴者などの項目を表示する。 */
  visit?: boolean;
  /** 会場（千葉／大阪）。送迎の選択肢と体験乗馬の表示に使う。 */
  venue?: Venue | null;
  initialPartySize?: number;
  initialNote?: string | null;
  initialPickup?: string | null;
  initialRiding?: boolean;
  initialCompanions?: BookingCompanion[];
  maxPartySize?: number;
}) {
  const router = useRouter();
  const max = Math.max(1, Math.min(20, maxPartySize));
  // 同伴者の上限：規定の最大3名と、残席（本人1名分を引いた数）の小さい方。
  const companionLimit = Math.max(0, Math.min(MAX_COMPANIONS, max - 1));

  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [partySize, setPartySize] = useState(
    Math.max(1, Math.min(max, initialPartySize ?? 1)),
  );
  const [note, setNote] = useState(initialNote ?? "");
  const [pickup, setPickup] = useState<string>(initialPickup ?? PICKUP_NONE);
  const [riding, setRiding] = useState<boolean>(initialRiding ?? false);
  const [companions, setCompanions] = useState<BookingCompanion[]>(
    (initialCompanions ?? []).slice(0, companionLimit),
  );
  const [err, setErr] = useState<string | null>(null);

  const showRiding = ridingAvailable(venue);
  const pickupOptions = venue ? PICKUP_OPTIONS[venue] : [];

  const addCompanion = () => {
    if (companions.length >= companionLimit) return;
    setCompanions((prev) => [...prev, { name: "", relation: "family" }]);
  };
  const updateCompanion = (i: number, patch: Partial<BookingCompanion>) =>
    setCompanions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeCompanion = (i: number) =>
    setCompanions((prev) => prev.filter((_, idx) => idx !== i));

  const run = async () => {
    setBusy(true);
    setErr(null);
    const method = cancel ? "DELETE" : edit ? "PATCH" : "POST";
    const cleanCompanions = companions
      .map((c) => ({ name: c.name.trim(), relation: c.relation }))
      .filter((c) => c.name.length > 0);
    const body: Record<string, unknown> = { event_id: eventId };
    if (!cancel) {
      body.note = note || null;
      if (visit) {
        body.pickup = pickup;
        body.riding = riding;
        body.companions = cleanCompanions;
      } else {
        body.party_size = partySize;
      }
    }
    const res = await fetch("/api/mypage/bookings", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(j.error ?? "処理できませんでした");
      return;
    }
    setOpen(false);
    router.refresh();
  };

  if (cancel) {
    return (
      <button
        onClick={() => {
          if (!confirm("予約をキャンセルしますか？")) return;
          run();
        }}
        disabled={disabled || busy}
        className="btn-ghost !py-1.5 !px-3 text-danger"
      >
        {busy ? "処理中..." : "キャンセル"}
      </button>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        className={edit ? "btn-ghost !py-1.5 !px-3" : "btn-primary !py-2 !px-4"}
      >
        {edit ? "内容変更" : "予約する"}
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 p-3 border-2 border-surface-line rounded-xl bg-surface-soft">
      {visit ? (
        <>
          {/* 送迎の希望 */}
          {pickupOptions.length > 0 && (
            <div>
              <label className="label">送迎の希望</label>
              <div className="space-y-1">
                {pickupOptions.map((o) => (
                  <label key={o.code} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`pickup-${eventId}`}
                      className="w-4 h-4"
                      checked={pickup === o.code}
                      onChange={() => setPickup(o.code)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 体験乗馬（千葉のみ） */}
          {showRiding && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={riding}
                onChange={(e) => setRiding(e.target.checked)}
              />
              <span>馬に騎乗する（体験乗馬 約5分）を希望する</span>
            </label>
          )}

          {/* 同伴者（最大3名） */}
          <div>
            <label className="label">
              同伴者{" "}
              <span className="text-ink-mute font-normal">（最大{MAX_COMPANIONS}名）</span>
            </label>
            {companions.length === 0 && (
              <p className="text-xs text-ink-mute">同伴者がいる場合は追加してください。</p>
            )}
            <div className="space-y-2">
              {companions.map((c, i) => (
                <div key={i} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    className="input flex-1"
                    placeholder="お名前"
                    value={c.name}
                    maxLength={100}
                    onChange={(e) => updateCompanion(i, { name: e.target.value })}
                  />
                  <select
                    className="input sm:w-32"
                    value={c.relation}
                    onChange={(e) =>
                      updateCompanion(i, { relation: e.target.value as Relation })
                    }
                  >
                    {RELATION_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-ghost !py-1.5 !px-3 text-danger"
                    onClick={() => removeCompanion(i)}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
            {companions.length < companionLimit && (
              <button type="button" className="btn-ghost !py-1.5 !px-3 mt-2" onClick={addCompanion}>
                ＋ 同伴者を追加
              </button>
            )}
            {companionLimit < MAX_COMPANIONS && (
              <p className="text-xs text-ink-mute mt-1">
                残席の都合により、追加できる同伴者は{companionLimit}名までです。
              </p>
            )}
          </div>
        </>
      ) : (
        <div>
          <label className="label">
            人数 <span className="text-ink-mute font-normal">（最大 {max} 名）</span>
          </label>
          <input
            type="number"
            min={1}
            max={max}
            className="input"
            value={partySize}
            onChange={(e) =>
              setPartySize(Math.max(1, Math.min(max, Number(e.target.value) || 1)))
            }
          />
        </div>
      )}

      <div>
        <label className="label">メモ（アレルギー等）</label>
        <textarea
          className="input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {err && <p className="text-danger text-sm">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setOpen(false)} disabled={busy}>
          戻る
        </button>
        <button className="btn-primary flex-1" onClick={run} disabled={busy}>
          {busy ? "処理中..." : edit ? "変更を保存" : "予約を確定"}
        </button>
      </div>
    </div>
  );
}
