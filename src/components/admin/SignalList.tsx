"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type Ref } from "react";
import { formatDate, formatUnits, formatYen } from "@/lib/format";
import type { BrightSpot, OpsSignal } from "@/lib/donationInsight";

const TONE = {
  alert: {
    label: "要対応",
    shell: "border-rose-200 bg-[linear-gradient(160deg,#fff5f5_0%,#ffffff_48%)]",
    kicker: "text-rose-800",
    pip: "bg-rose-500",
    row: "hover:bg-rose-50/80",
  },
  watch: {
    label: "注意",
    shell: "border-amber-200 bg-[linear-gradient(160deg,#fffbeb_0%,#ffffff_48%)]",
    kicker: "text-amber-900",
    pip: "bg-amber-500",
    row: "hover:bg-amber-50/80",
  },
  bright: {
    label: "明るい動き",
    shell: "border-emerald-200 bg-[linear-gradient(160deg,#f0fdf6_0%,#ffffff_42%)]",
    kicker: "text-emerald-900",
    pip: "bg-emerald-500",
    row: "hover:bg-emerald-50/80",
  },
} as const;

function SignalRows({ signals, rowClass }: { signals: OpsSignal[]; rowClass: string }) {
  return (
    <ul className="space-y-1.5">
      {signals.map((signal) => (
        <li key={`${signal.href}-${signal.title}`}>
          <Link href={signal.href} className={`block rounded-xl px-2.5 py-2 transition-colors ${rowClass}`}>
            <p className="text-sm font-bold leading-snug">{signal.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-black/60">{signal.detail}</p>
            {signal.meter && signal.meter.length > 0 ? (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {signal.meter.map((step) => (
                  <div key={step.label} className="rounded-lg bg-white/80 px-1.5 py-1.5 text-center">
                    <p className="text-[10px] text-black/45">{step.label}</p>
                    <p className="text-sm font-bold tabular-nums">{step.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CardFrame({
  toneKey,
  cardRef,
  height,
  children,
}: {
  toneKey: keyof typeof TONE;
  cardRef?: Ref<HTMLElement>;
  height?: number;
  children: React.ReactNode;
}) {
  const tone = TONE[toneKey];
  const locked = height != null;
  return (
    <section
      ref={cardRef}
      style={locked ? { height } : undefined}
      className={`flex min-w-0 flex-col rounded-2xl border p-4 shadow-sm shadow-black/5 ${tone.shell}`}
    >
      <h2 className={`flex shrink-0 items-center gap-2 text-xs font-bold tracking-wide ${tone.kicker}`}>
        <span className={`h-2 w-2 rounded-full ${tone.pip}`} />
        {tone.label}
      </h2>
      <div className={`mt-3 min-h-0 ${locked ? "flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:rgba(0,0,0,0.28)_transparent] [scrollbar-width:thin]" : ""}`}>
        {children}
      </div>
    </section>
  );
}

function BrightBody({ bright, extras }: { bright: BrightSpot; extras: OpsSignal[] }) {
  const tone = TONE.bright;
  return (
    <div>
      <Link href="/admin/payments?status=succeeded" className={`block rounded-xl px-1 py-1 transition-colors ${tone.row}`}>
        <p className="text-[11px] font-semibold text-black/50">{bright.label}に届いた支援</p>
        <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-emerald-950">{formatYen(bright.receivedYen)}</p>
        <p className="mt-1 text-xs text-black/60">成功した決済 {bright.receivedCount.toLocaleString("ja-JP")}件</p>
      </Link>
      <div className="mt-3 border-t border-emerald-100 pt-3">
        <p className="px-1 text-[11px] font-semibold text-black/50">口数が増えた馬 {bright.gained.length.toLocaleString("ja-JP")}頭</p>
        {bright.newSupports > 0 ? (
          <p className="mt-0.5 px-1 text-[11px] text-black/50">新しく始まった支援 {bright.newSupports.toLocaleString("ja-JP")}件</p>
        ) : null}
        {bright.gained.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {bright.gained.map((horse) => (
              <li key={horse.id}>
                <Link href="/admin/giving" className={`flex items-start justify-between gap-3 rounded-xl px-2.5 py-1.5 text-sm transition-colors ${tone.row}`}>
                  <span className="min-w-0 leading-snug">{horse.name}</span>
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold tabular-nums text-emerald-900">
                    +{formatUnits(horse.deltaUnits)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 px-1 text-xs leading-relaxed text-black/60">今月、口数が増えた馬はまだありません。</p>
        )}
      </div>
      {extras.length > 0 ? (
        <div className="mt-3">
          <SignalRows signals={extras} rowClass={tone.row} />
        </div>
      ) : null}
    </div>
  );
}

export default function SignalList({ signals, bright }: { signals: OpsSignal[]; bright: BrightSpot }) {
  const alerts = signals.filter((signal) => signal.level === "alert");
  const watches = signals.filter((signal) => signal.level === "watch");
  const goods = signals.filter((signal) => signal.level === "good");
  const firstRef = useRef<HTMLElement>(null);
  const [cardHeight, setCardHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const node = firstRef.current;
    if (!node) return;
    const apply = () => setCardHeight(Math.ceil(node.getBoundingClientRect().height));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [alerts, watches]);

  return (
    <div>
      <div className="grid items-start gap-3 lg:grid-cols-3">
        <CardFrame toneKey="alert" cardRef={firstRef}>
          {alerts.length > 0 ? (
            <SignalRows signals={alerts} rowClass={TONE.alert.row} />
          ) : (
            <p className="px-1 text-sm text-black/55">急いで見る項目はありません。</p>
          )}
        </CardFrame>
        <CardFrame toneKey="watch" height={cardHeight}>
          {watches.length > 0 ? (
            <SignalRows signals={watches} rowClass={TONE.watch.row} />
          ) : (
            <p className="px-1 text-sm text-black/55">気にしておく動きはありません。</p>
          )}
        </CardFrame>
        <CardFrame toneKey="bright" height={cardHeight}>
          <BrightBody bright={bright} extras={goods} />
        </CardFrame>
      </div>
      <p className="mt-2 px-1 text-[11px] text-black/45">
        {formatDate(bright.asOf, true)} 時点の数字です。ページを開くたびに更新されます。
      </p>
    </div>
  );
}
