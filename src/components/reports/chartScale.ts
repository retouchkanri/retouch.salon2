/** グラフの目盛りと数値表記。月次レポートと、システム開始前のまとめのグラフで共用する。 */

export function shortValue(value: number, money: boolean): string {
  if (!money) return Math.round(value).toLocaleString("ja-JP");
  if (Math.abs(value) >= 10000) {
    const man = value / 10000;
    const digits = man >= 100 ? 0 : 1;
    return `${man.toFixed(digits).replace(/\.0$/, "")}万`;
  }
  return Math.round(value).toLocaleString("ja-JP");
}

export function niceScale(max: number): { top: number; ticks: number[] } {
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
