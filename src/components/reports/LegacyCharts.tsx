import { niceScale, shortValue } from "@/components/reports/chartScale";
import { formatYen } from "@/lib/format";
import type { LegacyMonthRow } from "@/lib/legacyReport";

const MARK = "#2d6a4f";
const AXIS = "#94a3b8";
const GRID = "#e7ece9";
const TEXT = "#334155";

const WIDTH = 340;
const HEIGHT = 188;
const PAD = { left: 46, right: 16, top: 18, bottom: 32 };

type Shape = "line" | "bar";

/** 年ごとの区切り。月が32本並ぶので、横軸は月ではなく年で読ませる。 */
function yearSpans(months: LegacyMonthRow[]): { year: number; from: number; to: number }[] {
  const spans: { year: number; from: number; to: number }[] = [];
  months.forEach((row, index) => {
    const year = Number(row.ym.slice(0, 4));
    const last = spans[spans.length - 1];
    if (last && last.year === year) last.to = index;
    else spans.push({ year, from: index, to: index });
  });
  return spans;
}

function Chart({
  title,
  months,
  pick,
  shape,
}: {
  title: string;
  months: LegacyMonthRow[];
  pick: (row: LegacyMonthRow) => number;
  shape: Shape;
}) {
  const values = months.map(pick);
  const { top, ticks } = niceScale(Math.max(0, ...values));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const baseline = PAD.top + plotH;
  const slot = plotW / Math.max(1, values.length);
  const xOf = (index: number) => PAD.left + (index + 0.5) * slot;
  const yOf = (value: number) => PAD.top + (1 - value / top) * plotH;
  const barW = Math.min(24, Math.max(1, slot - 2));
  const radius = Math.min(2, barW / 2);
  const peak = values.indexOf(Math.max(...values));

  return (
    <article className="card">
      <h2 className="section-title">{title}</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label={`${title}の月ごとの推移`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} y1={yOf(tick)} x2={WIDTH - PAD.right} y2={yOf(tick)} stroke={tick === 0 ? AXIS : GRID} strokeWidth="1" />
            <text x={PAD.left - 6} y={yOf(tick) + 3} textAnchor="end" fontSize="10" fill={TEXT}>
              {shortValue(tick, true)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={baseline} stroke={AXIS} strokeWidth="1" />
        {yearSpans(months).map((span) => {
          const left = PAD.left + span.from * slot;
          const width = (span.to - span.from + 1) * slot;
          const era = span.year - 2018;
          return (
            <g key={span.year}>
              {span.from > 0 ? <line x1={left} y1={PAD.top} x2={left} y2={baseline + 4} stroke={GRID} strokeWidth="1" /> : null}
              <text x={left + width / 2} y={HEIGHT - 10} textAnchor="middle" fontSize="10" fill={TEXT}>
                {width >= 40 ? `令和${era}年` : `${era}年`}
              </text>
            </g>
          );
        })}
        {shape === "line" ? (
          <>
            <polyline
              fill="none"
              stroke={MARK}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={values.map((value, index) => `${xOf(index)},${yOf(value)}`).join(" ")}
            />
            <circle cx={xOf(peak)} cy={yOf(values[peak])} r="4" fill={MARK} />
          </>
        ) : (
          values.map((value, index) => {
            const y = yOf(value);
            const height = Math.max(0, baseline - y);
            const r = Math.min(radius, height);
            const x = xOf(index) - barW / 2;
            return (
              <path
                key={months[index].ym}
                d={`M ${x} ${baseline} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + barW - r} Q ${x + barW} ${y} ${x + barW} ${y + r} V ${baseline} Z`}
                fill={MARK}
              />
            );
          })
        )}
        {/* 数字は最大の月だけに付ける。ほかの月は下の表と、マウスを重ねたときの表示で読める。 */}
        <text
          x={xOf(peak) + (xOf(peak) > WIDTH - 60 ? 4 : 0)}
          y={yOf(values[peak]) - (shape === "line" ? 9 : 5)}
          textAnchor={xOf(peak) > WIDTH - 60 ? "end" : "middle"}
          fontSize="10"
          fontWeight="700"
          fill={TEXT}
        >
          {shortValue(values[peak], true)}
        </text>
        {values.map((value, index) => (
          <rect key={months[index].ym} x={PAD.left + index * slot} y={PAD.top} width={slot} height={plotH} fill="transparent">
            <title>{`${months[index].label}　${formatYen(value)}`}</title>
          </rect>
        ))}
      </svg>
    </article>
  );
}

export default function LegacyCharts({ months }: { months: LegacyMonthRow[] }) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Chart title="会費収入" months={months} pick={(row) => row.duesYen} shape="line" />
      <Chart title="入金収入（寄付・YouTube・馬の売却）" months={months} pick={(row) => row.depositYen} shape="bar" />
      <Chart title="収入の合計" months={months} pick={(row) => row.totalYen} shape="bar" />
    </section>
  );
}
