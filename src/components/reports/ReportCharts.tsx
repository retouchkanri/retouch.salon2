"use client";

import { useState } from "react";
import { niceScale, shortValue } from "@/components/reports/chartScale";
import { formatYen } from "@/lib/format";
import type { MonthReport } from "@/lib/monthlyReport";

type Point = MonthReport["series"][number];
type Kind = "line" | "bar" | "pie";

const SERIES = [
  { title: "会員数", pick: (point: Point) => point.members, money: false },
  { title: "一口支援の月額", pick: (point: Point) => point.supportYen, money: true },
  { title: "単発寄付（着金・決済済）", pick: (point: Point) => point.donationYen, money: true },
] as const;

const PIE_COLORS = ["#1b4332", "#2d6a4f", "#40916c", "#52b788", "#74c69d", "#95d5b2"];
const AXIS = "#94a3b8";
const GRID = "#e7ece9";

/** 直近6か月。システム開始から6か月たつまでは、開始月からの月を並べる。 */
function rangeLabel(series: Point[]): string {
  if (series.length >= 6) return "直近6か月";
  if (series.length <= 1) return series[0]?.label ?? "";
  return `${series[0].label}〜${series[series.length - 1].label}`;
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

function exactValue(value: number, money: boolean): string {
  return money ? formatYen(value) : Math.round(value).toLocaleString("ja-JP");
}

type Tip = { x: number; y: number; label: string; value: string };

function ChartTip({ tip, width, height }: { tip: Tip | null; width: number; height: number }) {
  if (!tip) return null;
  const above = tip.y > 40;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 whitespace-nowrap rounded-md border border-surface-line bg-white px-2 py-1 text-ink shadow-md"
      style={{
        left: `${(tip.x / width) * 100}%`,
        top: `${(tip.y / height) * 100}%`,
        transform: above ? "translate(-50%, calc(-100% - 8px))" : "translate(-50%, 8px)",
      }}
    >
      <p className="text-[10px] leading-none text-black/55">{tip.label}</p>
      <p className="mt-0.5 text-xs font-bold tabular-nums leading-none">{tip.value}</p>
    </div>
  );
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
  const coords = values.map((value, index) => ({ x: box.xOf(index), y: box.yOf(value), value }));
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${box.width} ${box.height}`} className="w-full h-auto" role="img">
        <Axes box={box} labels={points.map((point) => point.label)} money={money} />
        <polyline fill="none" stroke="#2d6a4f" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" points={coords.map((c) => `${c.x},${c.y}`).join(" ")} />
        {coords.map((c, index) => (
          <g key={points[index].ym}>
            <circle cx={c.x} cy={c.y} r="2.6" fill="#2d6a4f" />
            <circle
              cx={c.x}
              cy={c.y}
              r="11"
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setTip({ x: c.x, y: c.y, label: points[index].label, value: exactValue(c.value, money) })}
              onMouseLeave={() => setTip(null)}
            />
          </g>
        ))}
      </svg>
      <ChartTip tip={tip} width={box.width} height={box.height} />
    </div>
  );
}

function BarChart({ points, pick, money }: { points: Point[]; pick: (point: Point) => number; money: boolean }) {
  const values = points.map(pick);
  const box = plotBox(values);
  const barWidth = 10;
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${box.width} ${box.height}`} className="w-full h-auto" role="img">
        <Axes box={box} labels={points.map((point) => point.label)} money={money} />
        {values.map((value, index) => {
          const y = box.yOf(value);
          const height = Math.max(0, box.baseline - y);
          const show = () => setTip({ x: box.xOf(index), y: value === 0 ? box.baseline : y, label: points[index].label, value: exactValue(value, money) });
          return (
            <g key={points[index].ym}>
              <rect x={box.xOf(index) - barWidth / 2} y={y} width={barWidth} height={height} fill="#2d6a4f" />
              <circle cx={box.xOf(index)} cy={value === 0 ? box.baseline : y} r="11" fill="transparent" className="cursor-pointer" onMouseEnter={show} onMouseLeave={() => setTip(null)} />
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} width={box.width} height={box.height} />
    </div>
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
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 160 160" className="h-full w-full" role="img">
          {total === 0 ? <circle cx="80" cy="80" r="62" fill="#eef0f3" /> : slices.filter((slice) => slice.end > slice.start).map((slice) => {
            const mid = (slice.start + slice.end) / 2;
            return (
              <path
                key={slice.label}
                d={piePath(80, 80, 62, slice.start, slice.end)}
                fill={slice.color}
                className="cursor-pointer"
                onMouseEnter={() => setTip({
                  x: 80 + 40 * Math.cos(mid),
                  y: 80 + 40 * Math.sin(mid),
                  label: slice.label,
                  value: exactValue(slice.value, money),
                })}
                onMouseLeave={() => setTip(null)}
              />
            );
          })}
        </svg>
        <ChartTip tip={tip} width={160} height={160} />
      </div>
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
  const range = rangeLabel(series);
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
        {SERIES.map((item, index) => (
          <article key={item.title} className="card !overflow-visible">
            <h2 className="section-title">{index === 0 && range ? `${item.title}（${range}）` : item.title}</h2>
            {kind === "line" ? <LineChart points={series} pick={item.pick} money={item.money} /> : null}
            {kind === "bar" ? <BarChart points={series} pick={item.pick} money={item.money} /> : null}
            {kind === "pie" ? <PieChart points={series} pick={item.pick} money={item.money} /> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
