"use client";

import { useState } from "react";
import type { MonthReport } from "@/lib/monthlyReport";

type Point = MonthReport["series"][number];
type Kind = "line" | "bar" | "pie";

const SERIES = [
  { title: "会員数（直近6か月）", pick: (point: Point) => point.members, money: false },
  { title: "一口支援の月額", pick: (point: Point) => point.supportYen, money: true },
  { title: "単発寄付（着金・決済済）", pick: (point: Point) => point.donationYen, money: true },
] as const;

const PIE_COLORS = ["#1b4332", "#2d6a4f", "#40916c", "#52b788", "#74c69d", "#95d5b2"];
const AXIS = "#94a3b8";
const GRID = "#e7ece9";

function shortValue(value: number, money: boolean): string {
  if (!money) return Math.round(value).toLocaleString("ja-JP");
  if (Math.abs(value) >= 10000) {
    const man = value / 10000;
    const digits = man >= 100 ? 0 : 1;
    return `${man.toFixed(digits).replace(/\.0$/, "")}万`;
  }
  return Math.round(value).toLocaleString("ja-JP");
}

function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const rough = max / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / exp;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10) * exp;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let index = 0; index * step <= top + step * 0.001; index += 1) {
    ticks.push(Math.round(index * step * 1000) / 1000);
  }
  return { top, ticks };
}

function plotBox(values: number[]) {
  const width = 340;
  const height = 188;
  const padLeft = 46;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 32;
  const { top, ticks } = niceScale(Math.max(0, ...values));
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const yOf = (value: number) => padTop + (1 - value / top) * plotH;
  const xOf = (index: number) => padLeft + ((index + 0.5) * plotW) / Math.max(1, values.length);
  const baseline = padTop + plotH;
  return { width, height, padLeft, padRight, padTop, baseline, ticks, yOf, xOf, plotW };
}

function Axes({
  box,
  labels,
  money,
}: {
  box: ReturnType<typeof plotBox>;
  labels: string[];
  money: boolean;
}) {
  return (
    <g>
      {box.ticks.map((tick) => (
        <g key={tick}>
          <line x1={box.padLeft} y1={box.yOf(tick)} x2={box.width - box.padRight} y2={box.yOf(tick)} stroke={tick === 0 ? AXIS : GRID} strokeWidth="1" />
          <text x={box.padLeft - 6} y={box.yOf(tick) + 3} textAnchor="end" fontSize="10" fill="#334155">
            {shortValue(tick, money)}
          </text>
        </g>
      ))}
      <line x1={box.padLeft} y1={box.padTop} x2={box.padLeft} y2={box.baseline} stroke={AXIS} strokeWidth="1" />
      <line x1={box.padLeft} y1={box.baseline} x2={box.width - box.padRight} y2={box.baseline} stroke={AXIS} strokeWidth="1" />
      {labels.map((label, index) => (
        <text key={`${label}-${index}`} x={box.xOf(index)} y={box.height - 8} textAnchor="middle" fontSize="10" fill="#334155">
          {label}
        </text>
      ))}
    </g>
  );
}

function LineChart({ points, pick, money }: { points: Point[]; pick: (point: Point) => number; money: boolean }) {
  const values = points.map(pick);
  const box = plotBox(values);
  const coords = values.map((value, index) => ({ x: box.xOf(index), y: box.yOf(value) }));
  return (
    <svg viewBox={`0 0 ${box.width} ${box.height}`} className="w-full h-auto" role="img">
      <Axes box={box} labels={points.map((point) => point.label)} money={money} />
      <polyline fill="none" stroke="#2d6a4f" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" points={coords.map((c) => `${c.x},${c.y}`).join(" ")} />
      {coords.map((c, index) => (
        <circle key={points[index].ym} cx={c.x} cy={c.y} r="2.2" fill="#2d6a4f" />
      ))}
    </svg>
  );
}

function BarChart({ points, pick, money }: { points: Point[]; pick: (point: Point) => number; money: boolean }) {
  const values = points.map(pick);
  const box = plotBox(values);
  const barWidth = 10;
  return (
    <svg viewBox={`0 0 ${box.width} ${box.height}`} className="w-full h-auto" role="img">
      <Axes box={box} labels={points.map((point) => point.label)} money={money} />
      {values.map((value, index) => {
        const y = box.yOf(value);
        const height = Math.max(0, box.baseline - y);
        return (
          <rect
            key={points[index].ym}
            x={box.xOf(index) - barWidth / 2}
            y={y}
            width={barWidth}
            height={height}
            fill="#2d6a4f"
          />
        );
      })}
    </svg>
  );
}

function piePath(cx: number, cy: number, r: number, start: number, end: number): string {
  const sweep = end - start;
  if (sweep >= Math.PI * 2 - 0.0001) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function PieChart({ points, pick, money }: { points: Point[]; pick: (point: Point) => number; money: boolean }) {
  const values = points.map(pick);
  const total = values.reduce((sum, value) => sum + value, 0);
  let angle = -Math.PI / 2;
  const slices = values.map((value, index) => {
    const sweep = total === 0 ? 0 : (value / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    return { start, end: angle, value, label: points[index].label, color: PIE_COLORS[index % PIE_COLORS.length] };
  });
  return (
    <div className="flex flex-col items-start gap-3">
      <svg viewBox="0 0 160 160" className="h-32 w-32 shrink-0" role="img">
        {total === 0 ? <circle cx="80" cy="80" r="62" fill="#eef0f3" /> : slices.filter((slice) => slice.end > slice.start).map((slice) => (
          <path key={slice.label} d={piePath(80, 80, 62, slice.start, slice.end)} fill={slice.color} />
        ))}
      </svg>
      <ul className="min-w-0 space-y-1 text-sm">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: slice.color }} />
            <span>{slice.label}</span>
            <span className="tabular-nums">{shortValue(slice.value, money)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TABS: { id: Kind; label: string }[] = [
  { id: "line", label: "折れ線" },
  { id: "bar", label: "棒グラフ" },
  { id: "pie", label: "円グラフ" },
];

export default function ReportCharts({ series }: { series: MonthReport["series"] }) {
  const [kind, setKind] = useState<Kind>("line");
  return (
    <section className="space-y-4">
      <div className="no-print flex justify-end">
        <div className="flex gap-1" role="tablist" aria-label="グラフの種類">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={kind === tab.id}
              className={`rounded-full px-3 py-1 text-xs ${kind === tab.id ? "bg-brand text-white" : "bg-white text-ink"}`}
              onClick={() => setKind(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3" role="tabpanel">
        {SERIES.map((item) => (
          <article key={item.title} className="card">
            <h2 className="section-title">{item.title}</h2>
            {kind === "line" ? <LineChart points={series} pick={item.pick} money={item.money} /> : null}
            {kind === "bar" ? <BarChart points={series} pick={item.pick} money={item.money} /> : null}
            {kind === "pie" ? <PieChart points={series} pick={item.pick} money={item.money} /> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
