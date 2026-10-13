/**
 * 寄付状況レポート。経営管理の月次数字を、何が増減したかまで分解する。
 */
import { formatUnits } from "@/lib/format";
import {
  buildMonthReport,
  currentYearMonth,
  isSoldHorse,
  formatYearMonth,
  monthLabel,
  monthStart,
  parseYearMonth,
  shiftMonth,
  stripeReceipts,
  supportsActiveAt,
  type MonthReport,
  type ReportSource,
  type SupportRow,
} from "@/lib/monthlyReport";

export type IncomeSlice = {
  key: "dues" | "share" | "card" | "bank" | "other";
  label: string;
  current: number;
  previous: number;
  delta: number;
};

/**
 * 口数が動いた人。名前は持たず、顧客 ID だけを持つ（名前は、画面を出すときに顧客情報から引く）。
 * deltaUnits は、増えた分がプラス、減った分がマイナス。
 */
export type SupportMover = {
  customerId: string;
  horseId: string;
  horseName: string;
  deltaUnits: number;
  /** 停止した支援の一覧でだけ使う。停止のあとも、同じ馬に残っている口数。 */
  keptUnits?: number;
};

export type HorseMoney = {
  id: string;
  name: string;
  currentUnits: number;
  previousUnits: number;
  deltaUnits: number;
  currentYen: number;
  previousYen: number;
  deltaYen: number;
  /** この月に、この馬の口数を増やした人・減らした人。 */
  people: SupportMover[];
};

export type SignalLevel = "alert" | "watch" | "good";

export type OpsSignal = {
  level: SignalLevel;
  title: string;
  detail: string;
  href: string;
  meter?: { label: string; value: string }[];
  /** この項目にかかわる人（支援を停止した人、口数を減らした人）。 */
  people?: SupportMover[];
  /** people の出し方。"stopped" は、停止した支援の一覧。 */
  peopleMode?: "delta" | "stopped";
};

export type GainedHorse = {
  id: string;
  name: string;
  deltaUnits: number;
  /** この馬の口数を増やした人（新しく支援を始めた人を含む）。 */
  people: SupportMover[];
};

/** 管理者が安心できる、今月すでに起きた良い動き。現在の月は「いま」まで。過去の月は月末まで。 */
export type BrightSpot = {
  label: string;
  asOf: string;
  receivedYen: number;
  receivedCount: number;
  newSupports: number;
  gained: GainedHorse[];
};

export type GivingInsight = {
  current: MonthReport;
  previous: MonthReport;
  slices: IncomeSlice[];
  incomeDelta: number;
  horses: HorseMoney[];
  declining: { id: string; name: string; months: number[]; trail: string }[];
  shortHorses: { id: string; name: string; units: number }[];
  failedPayments: number;
  stoppedSupports: number;
  /** この月に停止した支援。stoppedSupports と同じ件数で、新しい停止が先。 */
  stopped: SupportMover[];
  bright: BrightSpot;
  signals: OpsSignal[];
};

function endMs(year: number, month: number): number {
  const next = shiftMonth(year, month, 1);
  return monthStart(next.year, next.month).getTime();
}

function inMonth(iso: string | null | undefined, startMs: number, end: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= startMs && t < end;
}

function monthEndMeter(year: number, month: number, units: number[]): { label: string; value: string }[] {
  return units.map((value, index) => {
    const point = shiftMonth(year, month, index - (units.length - 1));
    return { label: `${point.month}月末`, value: formatUnits(value) };
  });
}

function monthEndTrail(year: number, month: number, units: number[]): string {
  return `月末まで有効な口数：${monthEndMeter(year, month, units).map((step) => `${step.label} ${step.value}`).join(" → ")}`;
}

/** 2つの時点のあいだに、馬ごとに、誰の口数がどれだけ動いたか。動いた口数の大きい順。 */
function moversByHorse(source: ReportSource, fromMs: number, toMs: number, names: Map<string, string>): Map<string, SupportMover[]> {
  const unitsOf = (rows: SupportRow[]) => {
    const map = new Map<string, { horseId: string; customerId: string; units: number }>();
    for (const row of rows) {
      if (!row.customer_id) continue;
      const key = `${row.horse_id}|${row.customer_id}`;
      const cur = map.get(key) ?? { horseId: row.horse_id, customerId: row.customer_id, units: 0 };
      cur.units += Number(row.units) || 0;
      map.set(key, cur);
    }
    return map;
  };
  const before = unitsOf(supportsActiveAt(source, fromMs));
  const after = unitsOf(supportsActiveAt(source, toMs));
  const byHorse = new Map<string, SupportMover[]>();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = Math.round(((after.get(key)?.units ?? 0) - (before.get(key)?.units ?? 0)) * 100) / 100;
    if (delta === 0) continue;
    const { horseId, customerId } = (after.get(key) ?? before.get(key))!;
    const list = byHorse.get(horseId) ?? [];
    list.push({ customerId, horseId, horseName: names.get(horseId) ?? "（名称不明）", deltaUnits: delta });
    byHorse.set(horseId, list);
  }
  for (const list of byHorse.values()) {
    list.sort((a, b) => Math.abs(b.deltaUnits) - Math.abs(a.deltaUnits) || a.customerId.localeCompare(b.customerId));
  }
  return byHorse;
}

function buildBright(source: ReportSource, ym: string, start: number, end: number, now: Date): BrightSpot {
  const asOf = currentYearMonth(now) === ym ? Math.min(now.getTime(), end) : end;
  const names = new Map(source.horses.map((horse) => [horse.id, horse.name]));
  const before = horseMap(supportsActiveAt(source, start));
  const after = horseMap(supportsActiveAt(source, asOf));
  const movers = moversByHorse(source, start, asOf, names);
  const gained: GainedHorse[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const delta = Math.round(((after.get(id)?.units ?? 0) - (before.get(id)?.units ?? 0)) * 100) / 100;
    const name = names.get(id) ?? "（名称不明）";
    if (delta > 0 && !isDeceased(name)) {
      gained.push({ id, name, deltaUnits: delta, people: (movers.get(id) ?? []).filter((mover) => mover.deltaUnits > 0) });
    }
  }
  gained.sort((a, b) => b.deltaUnits - a.deltaUnits || a.name.localeCompare(b.name, "ja"));

  // Stripe の支払いを 1 件ずつ、決済額のまま数える（Stripe の画面の売上・件数と同じ）。
  // 同じ支払いが Webhook と Stripe 同期の2行で入るので、行をそのまま足すと二重になる。
  let receivedYen = 0;
  let receivedCount = 0;
  for (const receipt of stripeReceipts(source)) {
    if (receipt.at < start || receipt.at >= asOf) continue;
    receivedYen += receipt.amount;
    receivedCount += 1;
  }
  const newSupports = source.supports.filter(
    (support) => support.status !== "incomplete" && inMonth(support.started_at, start, asOf),
  ).length;

  return {
    label: monthLabel(ym),
    asOf: new Date(asOf).toISOString(),
    receivedYen,
    receivedCount,
    newSupports,
    gained,
  };
}

function isDeceased(name: string): boolean {
  return name.includes("故");
}

function horseMap(rows: SupportRow[]) {
  const map = new Map<string, { units: number; yen: number }>();
  for (const row of rows) {
    const cur = map.get(row.horse_id) ?? { units: 0, yen: 0 };
    cur.units += Number(row.units) || 0;
    cur.yen += Number(row.monthly_amount) || 0;
    map.set(row.horse_id, cur);
  }
  return map;
}

function slicesOf(current: MonthReport, previous: MonthReport): IncomeSlice[] {
  const rows: Omit<IncomeSlice, "delta">[] = [
    { key: "dues", label: "会費（定期支援）", current: current.duesYen, previous: previous.duesYen },
    { key: "share", label: "一口支援の入金", current: current.shareIncomeYen, previous: previous.shareIncomeYen },
    { key: "card", label: "単発寄付（カード）", current: current.donations.card, previous: previous.donations.card },
    { key: "bank", label: "単発寄付（銀行振込・着金）", current: current.donations.bank, previous: previous.donations.bank },
  ];
  // 会費にも一口支援にも振り分けられなかった定期入金。あるときだけ出して、内訳の合計を収入に合わせる。
  if (current.otherIncomeYen !== 0 || previous.otherIncomeYen !== 0) {
    // マイナスは、以前の月の決済をこの月に返金した分（元の決済の区分が分からないもの）。
    rows.push({ key: "other", label: "その他（区分できない入金・返金）", current: current.otherIncomeYen, previous: previous.otherIncomeYen });
  }
  return rows.map((row) => ({ ...row, delta: row.current - row.previous }));
}

export function supportStars(joinedAt: string | null, now = new Date()): number {
  if (!joinedAt) return 0;
  const from = new Date(joinedAt);
  if (Number.isNaN(from.getTime())) return 0;
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months -= 1;
  if (months < 6) return 0;
  return Math.min(5, Math.floor(months / 6));
}

/** 馬が登録されてから60日以内に支援を始めた人を、保護当初からの支援者とする。 */
export function isFoundingSupporter(supportStartedAt: string, horseCreatedAt: string): boolean {
  const started = new Date(supportStartedAt).getTime();
  const created = new Date(horseCreatedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(created)) return false;
  const day = 24 * 60 * 60 * 1000;
  return started >= created - day && started <= created + 60 * day;
}

export function buildGivingInsight(source: ReportSource, ym: string, now = new Date()): GivingInsight | null {
  const parsed = parseYearMonth(ym);
  if (!parsed) return null;
  const prev = shiftMonth(parsed.year, parsed.month, -1);
  const prevYm = formatYearMonth(prev.year, prev.month);
  const current = buildMonthReport(source, ym);
  const previous = buildMonthReport(source, prevYm);
  if (!current || !previous) return null;

  const start = monthStart(parsed.year, parsed.month).getTime();
  const end = endMs(parsed.year, parsed.month);
  const names = new Map(source.horses.map((horse) => [horse.id, horse.name]));
  const nowMap = horseMap(supportsActiveAt(source, end));
  const prevMap = horseMap(supportsActiveAt(source, start));
  const ids = new Set([...nowMap.keys(), ...prevMap.keys(), ...source.horses.map((horse) => horse.id)]);
  const movers = moversByHorse(source, start, end, names);
  const horses: HorseMoney[] = [];
  for (const id of ids) {
    const now = nowMap.get(id) ?? { units: 0, yen: 0 };
    const before = prevMap.get(id) ?? { units: 0, yen: 0 };
    if (now.units === 0 && before.units === 0 && now.yen === 0 && before.yen === 0) continue;
    horses.push({
      id,
      name: names.get(id) ?? "（名称不明）",
      currentUnits: now.units,
      previousUnits: before.units,
      deltaUnits: Math.round((now.units - before.units) * 100) / 100,
      currentYen: now.yen,
      previousYen: before.yen,
      deltaYen: now.yen - before.yen,
      people: movers.get(id) ?? [],
    });
  }
  horses.sort((a, b) => a.deltaYen - b.deltaYen);

  const monthEnds = [0, 1, 2].map((back) => {
    const point = shiftMonth(parsed.year, parsed.month, -back);
    return horseMap(supportsActiveAt(source, endMs(point.year, point.month)));
  });
  const declining = source.horses.flatMap((horse) => {
    const units = monthEnds.map((map) => map.get(horse.id)?.units ?? 0).reverse();
    if (units[0] > units[1] && units[1] > units[2]) {
      return [{
        id: horse.id,
        name: horse.name,
        months: units,
        trail: monthEndTrail(parsed.year, parsed.month, units),
        meter: monthEndMeter(parsed.year, parsed.month, units),
        // この月に、この馬の口数を減らした人。
        people: (movers.get(horse.id) ?? []).filter((mover) => mover.deltaUnits < 0),
      }];
    }
    return [];
  });

  // 支援を募っている馬だけを見る。オーナーが決まった馬（売却・譲渡）や、支援を受け付けていない枠は「口数なし」が普通。
  const shortHorses = source.horses
    .filter((horse) => !isDeceased(horse.name) && !isSoldHorse(horse.name) && horse.is_supportable !== false)
    .map((horse) => ({ id: horse.id, name: horse.name, units: nowMap.get(horse.id)?.units ?? 0 }))
    .filter((horse) => horse.units <= 0);

  // Stripe の失敗した決済の件数。Webhook が同じ失敗について入れた控えの行（請求IDあり・決済IDなし）は数えない。
  const failedPayments = source.payments.filter(
    (payment) =>
      payment.status === "failed" &&
      !(payment.invoice_id && !payment.charge_id) &&
      inMonth(payment.occurred_at, start, end),
  ).length;
  const stoppedRows = source.supports
    .filter((support) => inMonth(support.canceled_at, start, end))
    .sort((a, b) => new Date(b.canceled_at!).getTime() - new Date(a.canceled_at!).getTime());
  const stoppedSupports = stoppedRows.length;
  // 同じ人が同じ馬の支援を続けているとき（口数を変えるために登録し直したときなど）は、残っている口数も添える。
  const keptAtEnd = new Map<string, number>();
  for (const row of supportsActiveAt(source, end)) {
    const key = `${row.horse_id}|${row.customer_id}`;
    keptAtEnd.set(key, (keptAtEnd.get(key) ?? 0) + (Number(row.units) || 0));
  }
  const stopped: SupportMover[] = stoppedRows.map((support) => {
    const kept = keptAtEnd.get(`${support.horse_id}|${support.customer_id}`) ?? 0;
    return {
      customerId: support.customer_id,
      horseId: support.horse_id,
      horseName: names.get(support.horse_id) ?? "（名称不明）",
      deltaUnits: -(Number(support.units) || 0),
      ...(kept > 0 ? { keptUnits: kept } : {}),
    };
  });
  const bright = buildBright(source, ym, start, end, now);

  const slices = slicesOf(current, previous);
  const signals = buildSignals({
    current,
    previous,
    slices,
    declining,
    shortHorses,
    failedPayments,
    stoppedSupports,
    stopped,
  });

  return {
    current,
    previous,
    slices,
    incomeDelta: current.incomeYen - previous.incomeYen,
    horses,
    declining,
    shortHorses,
    failedPayments,
    stoppedSupports,
    stopped,
    bright,
    signals,
  };
}

/** 画面に名前を出す人の顧客 ID（重複なし）。 */
export function moverCustomerIds(insight: GivingInsight): string[] {
  const ids = new Set<string>();
  const add = (people: SupportMover[] | undefined) => {
    for (const mover of people ?? []) if (mover.customerId) ids.add(mover.customerId);
  };
  add(insight.stopped);
  for (const horse of insight.bright.gained) add(horse.people);
  for (const horse of insight.horses) add(horse.people);
  for (const signal of insight.signals) add(signal.people);
  return [...ids];
}

function rate(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function buildSignals(input: {
  current: MonthReport;
  previous: MonthReport;
  slices: IncomeSlice[];
  declining: { name: string; trail?: string; meter?: { label: string; value: string }[]; people?: SupportMover[] }[];
  shortHorses: { name: string }[];
  failedPayments: number;
  stoppedSupports: number;
  stopped?: SupportMover[];
}): OpsSignal[] {
  const signals: OpsSignal[] = [];
  if (input.failedPayments > 0) {
    signals.push({
      level: "alert",
      title: `決済エラー ${input.failedPayments}件`,
      detail: "今月、成功していない決済があります。",
      href: "/admin/payments?status=failed",
    });
  }
  if (input.stoppedSupports > 0) {
    signals.push({
      level: "alert",
      title: `支援停止 ${input.stoppedSupports}件`,
      detail: "今月、口数が終了した支援があります。",
      href: "/admin/supports",
      people: input.stopped,
      peopleMode: "stopped",
    });
  }
  const leaveNow = input.current.withdrawn / Math.max(1, input.previous.counts.total);
  const leavePrev = input.previous.withdrawn / Math.max(1, input.previous.counts.total);
  if (input.current.withdrawn >= 3 && leaveNow > leavePrev) {
    signals.push({
      level: "alert",
      title: "今月の退会率が前月より上昇",
      detail: `退会 ${input.current.withdrawn}名（前月 ${input.previous.withdrawn}名）`,
      href: "/admin/customers",
    });
  }
  if (input.shortHorses.length > 0) {
    signals.push({
      level: "alert",
      title: `支援口数が付いていない馬 ${input.shortHorses.length}頭`,
      detail: input.shortHorses.slice(0, 3).map((horse) => horse.name).join("、"),
      href: "/admin/giving",
    });
  }
  if (input.declining.length > 0) {
    signals.push({
      level: "watch",
      title: input.declining.length === 1 ? input.declining[0].name : `${input.declining.length}頭の支援が3か月連続で減少`,
      detail: input.declining.length === 1
        ? "支援が3か月連続で減っています。"
        : input.declining.slice(0, 3).map((horse) => horse.name).join("、"),
      meter: input.declining.length === 1 ? input.declining[0].meter : undefined,
      href: "/admin/giving",
      people: input.declining.flatMap((horse) => horse.people ?? []),
    });
  }
  const memberRate = rate(input.current.counts.members, input.previous.counts.members);
  if (memberRate != null && memberRate <= -4) {
    signals.push({
      level: "watch",
      title: `メンバーズ会員が前月比${memberRate.toFixed(1)}%`,
      detail: `${input.previous.counts.members}名から${input.current.counts.members}名`,
      href: "/admin/reports",
    });
  }
  const newRate = rate(input.current.newMembers, input.previous.newMembers);
  if (input.current.newMembers > 0 && (newRate == null || newRate > 0)) {
    signals.push({
      level: "good",
      title: `新規会員 ${input.current.newMembers}名`,
      detail: newRate == null ? "前月の新規はありません。" : `前月比 ${newRate > 0 ? "+" : ""}${newRate.toFixed(1)}%`,
      href: "/admin/reports",
    });
  }
  const donationRate = rate(input.current.donations.total, input.previous.donations.total);
  if (donationRate != null && donationRate > 0) {
    signals.push({
      level: "good",
      title: `単発寄付 前月比 +${donationRate.toFixed(1)}%`,
      detail: "カード決済と、着金確認済みの銀行振込の合計です。",
      href: "/admin/giving",
    });
  }
  return signals;
}
