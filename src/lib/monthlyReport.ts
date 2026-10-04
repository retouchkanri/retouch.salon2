/**
 * 経営管理画面と会員向け月次収支報告の集計（I/O なし）。
 * 月の境界は日本時間。公開後の会員向け表示は、ここではなく保存済みスナップショットを使う。
 */

export const BOARDING_PER_HORSE_YEN = 99_000;
export const OPERATING_EXPENSE_RATE = 0.2;

export const EXPENSE_FIELDS = [
  { key: "site", label: "サイト・システム運営費", hint: "公式サイト、会員サイト、サーバー、システム開発・保守" },
  { key: "payment_fees", label: "決済関連費", hint: "クレジットカード等の決済手数料、決済システム利用料" },
  { key: "transport", label: "馬の輸送費", hint: "保護馬の引取り、施設間移動、譲渡・移動" },
  { key: "trailer", label: "馬運車維持費", hint: "燃料、車検、保険、整備・修理、高速道路料金" },
  { key: "vehicle", label: "送迎・業務車両費", hint: "見学会・イベント・活動で使う車両の燃料、維持管理" },
  { key: "pr", label: "広報活動費", hint: "YouTube・SNSの撮影・編集、広告、印刷物" },
  { key: "events", label: "見学会・イベント費", hint: "設営・備品・運営費と、イベント時のアルバイト人件費（正社員の人件費は含めない）" },
] as const;

export type ExpenseKey = (typeof EXPENSE_FIELDS)[number]["key"];
export type ExpenseMap = Record<ExpenseKey, number>;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type CustomerRow = {
  id: string;
  email: string | null;
  status: string;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
};
export type ContractRow = {
  id: string;
  customer_id: string;
  started_at: string;
  canceled_at: string | null;
  status: string;
  plan_code: string | null;
};
export type SupportRow = {
  customer_id: string;
  horse_id: string;
  units: number;
  monthly_amount: number;
  started_at: string;
  canceled_at: string | null;
  status: string;
};
export type HorseRow = { id: string; name: string; created_at: string };
export type DonationRow = {
  amount: number;
  status: string;
  payment_method: string;
  donated_at: string;
  confirmed_at: string | null;
};
export type PaymentRow = {
  amount: number;
  status: string;
  kind: string;
  occurred_at: string;
  contract_id: string | null;
};
export type BookingRow = { booked_at: string; status: string };

export type ReportSource = {
  customers: CustomerRow[];
  contracts: ContractRow[];
  supports: SupportRow[];
  horses: HorseRow[];
  donations: DonationRow[];
  payments: PaymentRow[];
  bookings: BookingRow[];
  hiddenEmails?: readonly string[];
};

export type ClassCounts = {
  free: number;
  members: number;
  supportersPlan: number;
  relief: number;
  total: number;
  shareSupporters: number;
  shareUnits: number;
  supportYen: number;
};

export type HorseChange = {
  id: string;
  name: string;
  units: number;
  previousUnits: number;
  deltaUnits: number;
};

export type MonthReport = {
  ym: string;
  label: string;
  counts: ClassCounts;
  previous: ClassCounts;
  yearAgo: ClassCounts;
  newMembers: number;
  withdrawn: number;
  averageSupportYen: number;
  donations: { card: number; bank: number; total: number };
  duesYen: number;
  shareIncomeYen: number;
  incomeYen: number;
  operatingYen: number;
  careYen: number;
  boardingHorses: number;
  boardingYen: number;
  eventBookings: number;
  horsesUp: HorseChange[];
  horsesDown: HorseChange[];
  series: Array<{ ym: string; label: string; members: number; supportYen: number; donationYen: number }>;
};

export function emptyExpenses(): ExpenseMap {
  return { site: 0, payment_fees: 0, transport: 0, trailer: 0, vehicle: 0, pr: 0, events: 0 };
}

export function parseExpenses(raw: unknown): ExpenseMap {
  const base = emptyExpenses();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  for (const field of EXPENSE_FIELDS) {
    const n = Number(src[field.key]);
    base[field.key] = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }
  return base;
}

export function expenseTotal(expenses: ExpenseMap): number {
  return EXPENSE_FIELDS.reduce((sum, field) => sum + expenses[field.key], 0);
}

/** 前月比・前年比。比較先が 0 のときは null（「—」と表示する）。 */
export function changeRate(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatChange(rate: number | null): string {
  if (rate == null) return "—";
  const sign = rate > 0 ? "+" : "";
  return `${sign}${rate.toFixed(1)}%`;
}

export function parseYearMonth(ym: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 日本時間のその月 1 日 0:00 を UTC の Date で返す。 */
export function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - JST_OFFSET_MS);
}

export function currentYearMonth(now = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return formatYearMonth(jst.getUTCFullYear(), jst.getUTCMonth() + 1);
}

export function monthLabel(ym: string): string {
  const parsed = parseYearMonth(ym);
  if (!parsed) return ym;
  return `${parsed.year}年${parsed.month}月`;
}

function inMonth(iso: string | null | undefined, startMs: number, endMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= startMs && t < endMs;
}

function activeAt(startedAt: string, canceledAt: string | null, status: string, endMs: number): boolean {
  if (status === "incomplete") return false;
  if (status === "canceled" && !canceledAt) return false;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started) || started >= endMs) return false;
  if (!canceledAt) return status !== "canceled";
  const canceled = new Date(canceledAt).getTime();
  return !Number.isFinite(canceled) || canceled >= endMs;
}

function isDeceasedHorse(name: string): boolean {
  return /[（(]故[）)]/.test(name) || name.includes("故");
}

function countsAt(source: ReportSource, endMs: number, hidden: Set<string>): ClassCounts {
  const hiddenIds = new Set(
    source.customers.filter((c) => c.email && hidden.has(c.email.trim().toLowerCase())).map((c) => c.id),
  );
  const alive = source.customers.filter((c) => {
    if (hiddenIds.has(c.id)) return false;
    const joined = new Date(c.joined_at ?? c.created_at).getTime();
    if (!Number.isFinite(joined) || joined >= endMs) return false;
    if (c.status === "withdrawn") {
      const updated = new Date(c.updated_at).getTime();
      if (Number.isFinite(updated) && updated < endMs) return false;
    }
    return true;
  });
  const aliveIds = new Set(alive.map((c) => c.id));

  const classOf = new Map<string, Set<string>>();
  for (const contract of source.contracts) {
    if (!aliveIds.has(contract.customer_id)) continue;
    if (!contract.plan_code) continue;
    if (!activeAt(contract.started_at, contract.canceled_at, contract.status, endMs)) continue;
    const set = classOf.get(contract.customer_id) ?? new Set<string>();
    set.add(contract.plan_code);
    classOf.set(contract.customer_id, set);
  }

  let members = 0;
  let supportersPlan = 0;
  let relief = 0;
  let free = 0;
  for (const customer of alive) {
    const codes = classOf.get(customer.id) ?? new Set<string>();
    if (codes.has("A")) members += 1;
    if (codes.has("B")) supportersPlan += 1;
    if (codes.has("C")) relief += 1;
    if (!codes.has("A") && !codes.has("B") && !codes.has("C") && !codes.has("OWNER")) free += 1;
  }

  const shareCustomers = new Set<string>();
  let shareUnits = 0;
  let supportYen = 0;
  for (const support of source.supports) {
    if (!aliveIds.has(support.customer_id)) continue;
    if (!activeAt(support.started_at, support.canceled_at, support.status, endMs)) continue;
    shareCustomers.add(support.customer_id);
    shareUnits += Number(support.units) || 0;
    supportYen += Number(support.monthly_amount) || 0;
  }

  return {
    free,
    members,
    supportersPlan,
    relief,
    total: alive.length,
    shareSupporters: shareCustomers.size,
    shareUnits,
    supportYen,
  };
}

function donationSplit(donations: DonationRow[], startMs: number, endMs: number): { card: number; bank: number } {
  let card = 0;
  let bank = 0;
  for (const row of donations) {
    if (row.status !== "succeeded") continue;
    const amount = Number(row.amount) || 0;
    if (row.payment_method === "bank_transfer") {
      const when = row.confirmed_at ?? row.donated_at;
      if (inMonth(when, startMs, endMs)) bank += amount;
    } else if (inMonth(row.donated_at, startMs, endMs)) {
      card += amount;
    }
  }
  return { card, bank };
}

function planIncome(
  source: ReportSource,
  startMs: number,
  endMs: number,
): { duesYen: number; shareIncomeYen: number } {
  const planByContract = new Map(source.contracts.map((c) => [c.id, c.plan_code]));
  let duesYen = 0;
  let shareIncomeYen = 0;
  for (const payment of source.payments) {
    if (payment.status !== "succeeded" || payment.kind === "donation") continue;
    if (!inMonth(payment.occurred_at, startMs, endMs)) continue;
    const code = payment.contract_id ? planByContract.get(payment.contract_id) : null;
    const amount = Number(payment.amount) || 0;
    if (code === "A" || code === "B" || code === "C" || code === "OWNER") duesYen += amount;
    else if (code === "SUPPORT") shareIncomeYen += amount;
  }
  return { duesYen, shareIncomeYen };
}

/** 指定時点で有効な一口支援。月末は「翌月1日 0:00（日本時間）」のミリ秒を渡す。 */
export function supportsActiveAt(source: ReportSource, endMs: number): SupportRow[] {
  return source.supports.filter((support) =>
    activeAt(support.started_at, support.canceled_at, support.status, endMs),
  );
}

function horseChanges(source: ReportSource, endMs: number, prevEndMs: number): { up: HorseChange[]; down: HorseChange[] } {
  const names = new Map(source.horses.map((h) => [h.id, h.name]));
  const unitsAt = (boundary: number) => {
    const map = new Map<string, number>();
    for (const support of source.supports) {
      if (!activeAt(support.started_at, support.canceled_at, support.status, boundary)) continue;
      map.set(support.horse_id, (map.get(support.horse_id) ?? 0) + (Number(support.units) || 0));
    }
    return map;
  };
  const now = unitsAt(endMs);
  const prev = unitsAt(prevEndMs);
  const ids = new Set([...now.keys(), ...prev.keys()]);
  const changes: HorseChange[] = [];
  for (const id of ids) {
    const units = now.get(id) ?? 0;
    const previousUnits = prev.get(id) ?? 0;
    const deltaUnits = Math.round((units - previousUnits) * 100) / 100;
    if (deltaUnits === 0) continue;
    changes.push({ id, name: names.get(id) ?? "（名称不明）", units, previousUnits, deltaUnits });
  }
  const up = changes.filter((c) => c.deltaUnits > 0).sort((a, b) => b.deltaUnits - a.deltaUnits);
  const down = changes.filter((c) => c.deltaUnits < 0).sort((a, b) => a.deltaUnits - b.deltaUnits);
  return { up, down };
}

function boardingHorseCount(horses: HorseRow[], endMs: number, override: number | null): number {
  if (override != null && Number.isFinite(override) && override >= 0) return Math.round(override);
  return horses.filter((h) => {
    const created = new Date(h.created_at).getTime();
    return (!Number.isFinite(created) || created < endMs) && !isDeceasedHorse(h.name);
  }).length;
}

export function buildMonthReport(source: ReportSource, ym: string, horseCountOverride: number | null = null): MonthReport | null {
  const parsed = parseYearMonth(ym);
  if (!parsed) return null;
  const hidden = new Set((source.hiddenEmails ?? []).map((e) => e.trim().toLowerCase()));
  const start = monthStart(parsed.year, parsed.month);
  const next = shiftMonth(parsed.year, parsed.month, 1);
  const yearAgo = shiftMonth(parsed.year, parsed.month, -12);
  const yearAgoNext = shiftMonth(yearAgo.year, yearAgo.month, 1);
  const startMs = start.getTime();
  const endMs = monthStart(next.year, next.month).getTime();
  const prevEndMs = startMs;
  const counts = countsAt(source, endMs, hidden);
  const previous = countsAt(source, prevEndMs, hidden);
  const yearAgoCounts = countsAt(source, monthStart(yearAgoNext.year, yearAgoNext.month).getTime(), hidden);

  const donations = donationSplit(source.donations, startMs, endMs);
  const incomeParts = planIncome(source, startMs, endMs);
  const incomeYen = donations.card + donations.bank + incomeParts.duesYen + incomeParts.shareIncomeYen;
  const operatingYen = Math.round(incomeYen * OPERATING_EXPENSE_RATE);
  const careYen = incomeYen - operatingYen;
  const boardingHorses = boardingHorseCount(source.horses, endMs, horseCountOverride);
  const { up, down } = horseChanges(source, endMs, prevEndMs);

  let newMembers = 0;
  let withdrawn = 0;
  for (const customer of source.customers) {
    if (customer.email && hidden.has(customer.email.trim().toLowerCase())) continue;
    if (inMonth(customer.joined_at ?? customer.created_at, startMs, endMs)) newMembers += 1;
    if (customer.status === "withdrawn" && inMonth(customer.updated_at, startMs, endMs)) withdrawn += 1;
  }

  let eventBookings = 0;
  for (const booking of source.bookings) {
    if (booking.status === "canceled") continue;
    if (inMonth(booking.booked_at, startMs, endMs)) eventBookings += 1;
  }

  const series = [];
  for (let i = 5; i >= 0; i--) {
    const point = shiftMonth(parsed.year, parsed.month, -i);
    const pointNext = shiftMonth(point.year, point.month, 1);
    const pointStart = monthStart(point.year, point.month).getTime();
    const pointEnd = monthStart(pointNext.year, pointNext.month).getTime();
    const pointCounts = countsAt(source, pointEnd, hidden);
    const pointDonations = donationSplit(source.donations, pointStart, pointEnd);
    const pointYm = formatYearMonth(point.year, point.month);
    series.push({
      ym: pointYm,
      label: `${point.month}月`,
      members: pointCounts.total,
      supportYen: pointCounts.supportYen,
      donationYen: pointDonations.card + pointDonations.bank,
    });
  }

  return {
    ym,
    label: monthLabel(ym),
    counts,
    previous,
    yearAgo: yearAgoCounts,
    newMembers,
    withdrawn,
    averageSupportYen: counts.shareSupporters > 0 ? Math.round(counts.supportYen / counts.shareSupporters) : 0,
    donations: { card: donations.card, bank: donations.bank, total: donations.card + donations.bank },
    duesYen: incomeParts.duesYen,
    shareIncomeYen: incomeParts.shareIncomeYen,
    incomeYen,
    operatingYen,
    careYen,
    boardingHorses,
    boardingYen: boardingHorses * BOARDING_PER_HORSE_YEN,
    eventBookings,
    horsesUp: up,
    horsesDown: down,
    series,
  };
}
