"use client";

import { useMemo, useState } from "react";
import type { RevenuePeriod, RevenueSeries } from "@/lib/revenueSeries";

const PERIODS: { key: RevenuePeriod; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "週" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
];

type ChartType = "line" | "bar" | "pie";
const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: "line", label: "折れ線" },
  { key: "bar", label: "棒" },
  { key: "pie", label: "円" },
];

// 円グラフの配色（区分ごとに色分け）。順に割り当て、足りなければ循環。
const PIE_COLORS = [
  "#1b4332", "#2d6a4f", "#40916c", "#74c69d", "#f59e0b",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#a3a635",
  "#6366f1", "#d946ef", "#0ea5e9", "#84cc16", "#f43f5e",
];

// ── 円グラフ座標系 ──
const PIE_CX = 60;
const PIE_CY = 60;
const PIE_R = 52;

/** 扇形（パイのスライス）のSVGパス。 */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
}

// ── 座標系（viewBox） ──
const W = 360;
const H = 176;
const PAD_L = 46; // 左の価格ラベル用の余白
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 26; // 下の期間ラベル用の余白
const PLOT_X0 = PAD_L;
const PLOT_X1 = W - PAD_R;
const PLOT_Y0 = PAD_T; // 上端
const PLOT_Y1 = H - PAD_B; // 基線
const PLOT_W = PLOT_X1 - PLOT_X0;
const PLOT_H = PLOT_Y1 - PLOT_Y0;

/** 軸用のコンパクトな円表記（例: ¥1.2万 / ¥500 / ¥3億）。 */
function axisYen(v: number): string {
  if (v <= 0) return "¥0";
  if (v >= 1e8) return `¥${(v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 1)}億`;
  if (v >= 1e4) return `¥${(v / 1e4).toFixed(v % 1e4 === 0 ? 0 : 1)}万`;
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

/** 正確な金額表記（ツールチップ用）。 */
function fullYen(v: number): string {
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

/** きりの良い上限値（軸の最大目盛り）。 */
function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const f = x / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * base;
}

/** 単調（Fritsch–Carlson）な 3 次スプライン。データ点を正確に通り、行き過ぎない。 */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    slope[i] = (ys[i + 1] - ys[i]) / dx[i];
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const cp1x = xs[i] + dx[i] / 3;
    const cp1y = ys[i] + (m[i] * dx[i]) / 3;
    const cp2x = xs[i + 1] - dx[i] / 3;
    const cp2y = ys[i + 1] - (m[i + 1] * dx[i]) / 3;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return d;
}

export default function RevenueChart({ series }: { series: RevenueSeries }) {
  const [period, setPeriod] = useState<RevenuePeriod>("month");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [hover, setHover] = useState<number | null>(null);

  const data = series[period];

  const view = useMemo(() => {
    const n = data.length;
    const maxVal = Math.max(...data.map((d) => d.total), 0);
    const top = niceCeil(maxVal);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);

    // 折れ線用の点（先頭=左端、末尾=右端）。
    const pts = data.map((d, i) => {
      const x = n <= 1 ? (PLOT_X0 + PLOT_X1) / 2 : PLOT_X0 + (i / (n - 1)) * PLOT_W;
      const y = PLOT_Y1 - (top > 0 ? (d.total / top) * PLOT_H : 0);
      return { x, y };
    });

    // 棒グラフ用のバンド（各データを等幅の区画の中央に配置）。
    const band = n > 0 ? PLOT_W / n : PLOT_W;
    const barW = Math.min(band * 0.62, 22);
    const bars = data.map((d, i) => {
      const cx = PLOT_X0 + (i + 0.5) * band;
      const h = top > 0 ? (d.total / top) * PLOT_H : 0;
      return { cx, x: cx - barW / 2, w: barW, y: PLOT_Y1 - h, h, band };
    });

    const linePath = monotonePath(pts);
    const areaPath =
      pts.length >= 2
        ? `${linePath} L${pts[pts.length - 1].x},${PLOT_Y1} L${pts[0].x},${PLOT_Y1} Z`
        : "";

    // x 軸ラベルの間引き（多すぎると重なるため）。末尾ラベルと直前の間引き位置が近すぎる場合は置換する。
    const step = Math.max(1, Math.ceil(n / 6));
    const xLabelSet = new Set<number>();
    for (let i = 0; i < n; i += step) xLabelSet.add(i);
    if (n > 1) {
      const last = n - 1;
      const prevShown = [...xLabelSet].filter((i) => i < last).pop();
      if (prevShown != null && last - prevShown < Math.max(1, Math.ceil(step * 0.65))) {
        xLabelSet.delete(prevShown);
      }
      xLabelSet.add(last);
    }
    const xLabels = [...xLabelSet].sort((a, b) => a - b);

    // 円グラフ用スライス（金額>0 の区分のみ。上から時計回り）。
    const pieSum = data.reduce((a, d) => a + Math.max(d.total, 0), 0);
    let ang = -Math.PI / 2;
    const pieSlices = data
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.total > 0)
      .map(({ d, i }, k) => {
        const frac = pieSum > 0 ? d.total / pieSum : 0;
        const a0 = ang;
        const a1 = ang + frac * 2 * Math.PI;
        ang = a1;
        return {
          i,
          label: d.label,
          tip: d.tip,
          value: d.total,
          frac,
          a0,
          a1,
          mid: (a0 + a1) / 2,
          color: PIE_COLORS[k % PIE_COLORS.length],
        };
      });

    return { n, maxVal, ticks, pts, bars, linePath, areaPath, xLabels, pieSum, pieSlices };
  }, [data]);

  const hasData = view.maxVal > 0;
  const hp = hover != null ? view.pts[hover] : null;
  // ラベル/ホバーの基準 x（モードで切替）。
  const anchorX = (i: number) => (chartType === "bar" ? view.bars[i].cx : view.pts[i].x);

  return (
    <div>
      {/* ヘッダー: タイトル + 種類切替 + 期間切替 */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-base font-bold text-ink flex items-center gap-2">収益推移</h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 折れ線 / 棒 切替 */}
          <div className="inline-flex rounded-full border border-surface-line/80 bg-white p-0.5 gap-0.5">
            {CHART_TYPES.map((t) => {
              const active = t.key === chartType;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setChartType(t.key);
                    setHover(null);
                  }}
                  aria-pressed={active}
                  className={`px-2.5 py-1 text-xs rounded-full transition-all ${
                    active
                      ? "bg-brand-50 text-brand-dark font-bold shadow-sm"
                      : "text-ink-mute hover:text-ink hover:bg-surface-soft"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {/* 日 / 週 / 月 / 年 切替 */}
          <div className="inline-flex rounded-full border border-surface-line/80 bg-white p-0.5 gap-0.5">
            {PERIODS.map((p) => {
              const active = p.key === period;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setPeriod(p.key);
                    setHover(null);
                  }}
                  aria-pressed={active}
                  className={`px-2.5 py-1 text-xs rounded-full transition-all ${
                    active
                      ? "bg-brand-50 text-brand-dark font-bold shadow-sm"
                      : "text-ink-mute hover:text-ink hover:bg-surface-soft"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative">
        {chartType !== "pie" && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="収益推移チャート"
        >
          <defs>
            <linearGradient id="adminChartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1b4332" stopOpacity="0.14" />
              <stop offset="70%" stopColor="#1b4332" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#1b4332" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="adminBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2d6a4f" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#1b4332" stopOpacity="0.88" />
            </linearGradient>
            <filter id="lineShadow" x="-4%" y="-10%" width="108%" height="130%">
              <feDropShadow dx="0" dy="1" stdDeviation="0.8" floodColor="#0d2818" floodOpacity="0.2" />
            </filter>
          </defs>

          {/* 横グリッド + 左の価格ラベル */}
          {view.ticks.map((tv, i) => {
            const y = PLOT_Y1 - (view.ticks.length > 1 ? (i / (view.ticks.length - 1)) * PLOT_H : 0);
            return (
              <g key={i}>
                <line
                  x1={PLOT_X0}
                  y1={y}
                  x2={PLOT_X1}
                  y2={y}
                  stroke="#f0f2f4"
                  strokeWidth="0.6"
                  strokeDasharray={i === 0 ? "0" : "2 3"}
                />
                <text
                  x={PLOT_X0 - 6}
                  y={y + 2}
                  textAnchor="end"
                  className="fill-ink-mute"
                  style={{ fontSize: 6 }}
                >
                  {axisYen(tv)}
                </text>
              </g>
            );
          })}

          {hasData && chartType === "bar" && (
            <>
              {/* 棒 */}
              {view.bars.map((b, i) => (
                <rect
                  key={i}
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={Math.max(b.h, 0.4)}
                  rx={Math.min(b.w / 2, 4)}
                  fill="url(#adminBarGrad)"
                  opacity={hover == null || hover === i ? 1 : 0.5}
                />
              ))}
              {/* 当たり判定（バンド全体） + 値ラベル */}
              {view.bars.map((b, i) => (
                <rect
                  key={`hit-${i}`}
                  x={b.cx - b.band / 2}
                  y={PLOT_Y0}
                  width={b.band}
                  height={PLOT_H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "pointer" }}
                />
              ))}
              {hover != null && (
                <text
                  x={Math.min(Math.max(view.bars[hover].cx, PLOT_X0 + 16), PLOT_X1 - 16)}
                  y={Math.max(view.bars[hover].y - 4, PLOT_Y0 + 6)}
                  textAnchor="middle"
                  className="fill-brand-dark"
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    paintOrder: "stroke",
                    stroke: "white",
                    strokeWidth: 2.5,
                    strokeLinejoin: "round",
                  }}
                >
                  {fullYen(data[hover].total)}
                </text>
              )}
            </>
          )}

          {hasData && chartType === "line" && (
            <>
              {/* エリア塗り */}
              {view.areaPath && <path d={view.areaPath} fill="url(#adminChartGrad)" />}
              {/* 本線（単調スプライン）— 細く／濃い緑 */}
              <path
                d={view.linePath}
                fill="none"
                stroke="#1b4332"
                strokeWidth="1.15"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#lineShadow)"
              />
              {/* ホバー時の縦ガイド */}
              {hp && (
                <line
                  x1={hp.x}
                  y1={PLOT_Y0}
                  x2={hp.x}
                  y2={PLOT_Y1}
                  stroke="#1b4332"
                  strokeWidth="0.5"
                  strokeDasharray="2 2"
                  opacity="0.45"
                />
              )}
              {/* データ点 */}
              {view.pts.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={hover === i ? 2.8 : 2}
                    fill="white"
                    stroke="#1b4332"
                    strokeWidth={hover === i ? 1.2 : 0.85}
                  />
                  {hover === i && <circle cx={p.x} cy={p.y} r="1" fill="#1b4332" />}
                  {/* 当たり判定（透明・広め） */}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="9"
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  />
                </g>
              ))}
              {/* ホバー時の値ラベル（白フチで可読性を確保） */}
              {hp && hover != null && (
                <text
                  x={Math.min(Math.max(hp.x, PLOT_X0 + 16), PLOT_X1 - 16)}
                  y={Math.max(hp.y - 6, PLOT_Y0 + 6)}
                  textAnchor="middle"
                  className="fill-brand-dark"
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    paintOrder: "stroke",
                    stroke: "white",
                    strokeWidth: 2.5,
                    strokeLinejoin: "round",
                  }}
                >
                  {fullYen(data[hover].total)}
                </text>
              )}
            </>
          )}

          {/* x 軸ラベル（間引き・末尾の重なり回避） */}
          {view.xLabels.map((i) => {
            const d = data[i];
            if (!d) return null;
            return (
              <text
                key={i}
                x={anchorX(i)}
                y={H - 8}
                textAnchor="middle"
                className={hover === i ? "fill-ink font-bold" : "fill-ink-mute"}
                style={{ fontSize: 6 }}
              >
                {d.label}
              </text>
            );
          })}
        </svg>
        )}

        {chartType === "pie" && hasData && (
          <div className="flex flex-col sm:flex-row items-center gap-4 py-1">
            <svg
              viewBox="0 0 120 120"
              className="w-44 h-44 shrink-0"
              role="img"
              aria-label="収益内訳（円グラフ）"
            >
              {view.pieSlices.map((s) =>
                s.frac >= 0.9999 ? (
                  <circle
                    key={s.i}
                    cx={PIE_CX}
                    cy={PIE_CY}
                    r={PIE_R}
                    fill={s.color}
                    opacity={hover == null || hover === s.i ? 1 : 0.45}
                    onMouseEnter={() => setHover(s.i)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  />
                ) : (
                  <path
                    key={s.i}
                    d={arcPath(PIE_CX, PIE_CY, PIE_R, s.a0, s.a1)}
                    fill={s.color}
                    stroke="#fff"
                    strokeWidth="1"
                    opacity={hover == null || hover === s.i ? 1 : 0.45}
                    onMouseEnter={() => setHover(s.i)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  />
                ),
              )}
              {/* 大きいスライスには割合(%)を内側に表示 */}
              {view.pieSlices
                .filter((s) => s.frac >= 0.08)
                .map((s) => {
                  const lx = PIE_CX + PIE_R * 0.62 * Math.cos(s.mid);
                  const ly = PIE_CY + PIE_R * 0.62 * Math.sin(s.mid);
                  return (
                    <text
                      key={`pct-${s.i}`}
                      x={lx}
                      y={ly + 2}
                      textAnchor="middle"
                      style={{
                        fontSize: 6.5,
                        fontWeight: 700,
                        fill: "#fff",
                        paintOrder: "stroke",
                        stroke: "rgba(0,0,0,0.22)",
                        strokeWidth: 0.7,
                      }}
                    >
                      {Math.round(s.frac * 100)}%
                    </text>
                  );
                })}
            </svg>

            {/* 凡例：区分名・金額・割合（金額は収益データの値をそのまま表示） */}
            <div className="w-full text-sm divide-y divide-surface-line/70 max-h-56 overflow-auto">
              {view.pieSlices.map((s) => (
                <div
                  key={s.i}
                  className={`flex items-center gap-2 px-1.5 py-1 rounded ${hover === s.i ? "bg-surface-soft" : ""}`}
                  onMouseEnter={() => setHover(s.i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: s.color }} />
                  <span className="text-ink-soft shrink-0 w-16">{s.label}</span>
                  <span className="ml-auto font-bold tabular-nums text-ink">{fullYen(s.value)}</span>
                  <span className="tabular-nums text-ink-mute w-12 text-right">{Math.round(s.frac * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasData && (
          <p className="text-xs text-ink-mute text-center mt-2">この期間の決済データはまだありません</p>
        )}

        {/* ホバー詳細（チャート下のキャプション） */}
        <p className="mt-1.5 text-center text-xs text-ink-mute h-4">
          {hover != null ? (
            <span>
              <span className="text-ink-soft">{data[hover].tip}</span>
              <span className="mx-1.5 text-surface-line">|</span>
              <span className="font-bold text-brand-dark tabular-nums">{fullYen(data[hover].total)}</span>
            </span>
          ) : (
            "点にカーソルを合わせると詳細を表示します"
          )}
        </p>
      </div>
    </div>
  );
}
