"use client";

import { useEffect, useId, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatUnits } from "@/lib/format";
import EmergencyHorseImage from "@/components/EmergencyHorseImage";
import horsePortrait from "@/assets/images/horse-portrait.jpg";

export type HorseCardData = {
  id: string;
  name: string;
  profile: string | null;
  imageUrl: string | null;
  isSupportable: boolean;
  emergency: boolean;
  totalUnits: number;
  supporters: number;
  nicknames: string[];
  supportHref: string;
};

type Props = {
  horses: HorseCardData[];
};

function HorseThumb({
  horse,
  sizeClass,
}: {
  horse: HorseCardData;
  sizeClass: string;
}) {
  if (horse.emergency) {
    return (
      <EmergencyHorseImage
        name={horse.name}
        sizeClass={sizeClass}
        imageUrl={horse.imageUrl}
      />
    );
  }
  return (
    <div className={`${sizeClass} rounded-lg overflow-hidden shrink-0 bg-brand-50`}>
      {horse.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={horse.imageUrl} alt={horse.name} className="w-full h-full object-cover" />
      ) : (
        <Image src={horsePortrait} alt={horse.name} className="w-full h-full object-cover" />
      )}
    </div>
  );
}

function StatusLine({ horse }: { horse: HorseCardData }) {
  const hasSupport = horse.totalUnits > 0;
  if (horse.emergency) {
    return <p className="text-xs text-pink-600 font-semibold mt-0.5">★支援募集開始★</p>;
  }
  if (hasSupport) {
    return (
      <p className="text-xs text-ink-soft mt-0.5">
        支援者 {horse.supporters}名 / {formatUnits(horse.totalUnits)}
      </p>
    );
  }
  return (
    <p className="text-xs text-brand font-semibold mt-0.5">
      {horse.isSupportable ? "支援者募集中 ✦" : "現在募集停止中"}
    </p>
  );
}

export default function HorsesSupportGrid({ horses }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const titleId = useId();
  const selected = horses.find((h) => h.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [selected]);

  return (
    <>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {horses.map((horse) => {
          const hasSupport = horse.totalUnits > 0;
          return (
            <button
              key={horse.id}
              type="button"
              onClick={() => setSelectedId(horse.id)}
              className={`relative rounded-xl border flex flex-col text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40
                ${horse.emergency
                  ? "border-pink-300 bg-pink-50/30"
                  : hasSupport
                    ? "border-surface-line bg-white"
                    : "border-dashed border-brand/30 bg-brand-50/20"}`}
            >
              <div className="flex items-center gap-3 p-3">
                <HorseThumb horse={horse} sizeClass="w-14 h-14" />
                <div className="min-w-0 flex-1">
                  <p className={`font-bold truncate ${horse.emergency ? "text-pink-700" : "text-ink"}`}>
                    {horse.name}
                  </p>
                  <StatusLine horse={horse} />
                </div>
              </div>

              {horse.nicknames.length > 0 && (
                <div className="px-3 pb-2 flex flex-wrap gap-1">
                  {horse.nicknames.map((name, i) => (
                    <span
                      key={`${horse.id}-nick-${i}`}
                      className="text-[11px] bg-brand-50 text-brand-dark border border-brand-100 px-2 py-0.5 rounded-full"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}

              {horse.profile && (
                <p className="px-3 pb-2 text-xs text-ink-mute line-clamp-2 leading-relaxed">
                  {horse.profile}
                </p>
              )}

              {horse.isSupportable && (
                <div className="mt-auto px-3 pb-3 pt-1">
                  <span
                    className={`block w-full text-center text-xs font-bold py-1.5 rounded-lg
                      ${horse.emergency
                        ? "bg-pink-500 text-white"
                        : "bg-brand text-white"}`}
                  >
                    この馬を支援する
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 bg-black/55 backdrop-blur-sm animate-[fadeIn_200ms_ease]"
          role="presentation"
          onClick={() => setSelectedId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative w-full max-w-lg max-h-[min(90dvh,720px)] flex flex-col bg-white rounded-2xl shadow-2xl border border-surface-line overflow-hidden animate-[scaleIn_200ms_ease]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4 p-5 sm:p-6 border-b border-surface-line shrink-0">
              <HorseThumb horse={selected} sizeClass="w-20 h-20" />
              <div className="min-w-0 flex-1">
                <h3
                  id={titleId}
                  className={`font-bold text-lg sm:text-xl leading-snug ${selected.emergency ? "text-pink-700" : "text-ink"}`}
                >
                  {selected.name}
                </h3>
                <StatusLine horse={selected} />
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="shrink-0 w-9 h-9 rounded-full text-ink-soft hover:bg-surface-soft hover:text-ink transition-colors"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4">
              {selected.nicknames.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ink-soft mb-2">支援者ニックネーム</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.nicknames.map((name, i) => (
                      <span
                        key={`${selected.id}-modal-nick-${i}`}
                        className="text-xs bg-brand-50 text-brand-dark border border-brand-100 px-2.5 py-1 rounded-full"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selected.profile ? (
                <div>
                  <p className="text-xs font-semibold text-ink-soft mb-2">プロフィール</p>
                  <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{selected.profile}</p>
                </div>
              ) : (
                <p className="text-sm text-ink-mute">プロフィールはまだ登録されていません。</p>
              )}
            </div>

            <div className="shrink-0 border-t border-surface-line p-4 sm:p-5 flex flex-wrap gap-2 justify-end bg-white">
              <button type="button" onClick={() => setSelectedId(null)} className="btn-secondary">
                閉じる
              </button>
              {selected.isSupportable && (
                <Link
                  href={selected.supportHref}
                  className={`btn-primary ${selected.emergency ? "!bg-pink-500 hover:!bg-pink-600" : ""}`}
                >
                  この馬を支援する
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
