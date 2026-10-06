/**
 * 経営管理画面と会員向け月次収支報告の集計（I/O なし）。
 * 月の境界は日本時間。公開後の会員向け表示は、ここではなく保存済みスナップショットを使う。
 */

export const BOARDING_PER_HORSE_YEN = 99_000;
export const OPERATING_EXPENSE_RATE = 0.2;
/** 会員サイトで集計を始めた月。これより前は公開済みの収支（legacyReport.ts）を使う。 */
export const SYSTEM_START_YM = "2026-07";

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
export type HorseRow = {
  id: string;
  name: string;
  created_at: string;
  /** 支援を受け付けている馬か。オーナーが決まった馬や、馬ではない募集枠は false。 */
  is_supportable?: boolean | null;
};
export type DonationRow = {
  amount: number;
  status: string;
  payment_method: string;
  donated_at: string;
  confirmed_at: string | null;
  /** Stripe で決済された寄付にだけある。これがある寄付は、金額も日付も Stripe の決済から数える。 */
  payment_intent_id?: string | null;
};
export type IncomeKind = "dues" | "team" | "share" | "other";
export type PaymentLine = { amount: number; kind: IncomeKind };
export type PaymentRow = {
  amount: number;
  status: string;
  kind: string;
  occurred_at: string;
  contract_id: string | null;
  /** Stripe の請求ID。同じ請求が Webhook と Stripe 同期の2行で入るので、これで1件にまとめる。 */
  invoice_id?: string | null;
  /** Stripe の決済ID。カードの単発寄付も Webhook と同期の2行で入る。 */
  payment_intent_id?: string | null;
  /** 請求明細（Webhook の行にだけある）。会費・一口支援の振り分けに使う。 */
  lines?: PaymentLine[] | null;
  /** 返金した金額（Stripe 同期の行にだけある）。一部返金のとき、決済額より小さい。 */
  refunded_amount?: number | null;
  /** 返金した日時。返金の明細（refunds）が無い古い行で使う。 */
  refunded_at?: string | null;
  /** 返金の明細（Stripe 同期の行にだけある）。返金は、行われた日の月に数える。 */
  refunds?: { amount: number; at: string }[] | null;
  /** Stripe の決済ID（Stripe 同期の行にだけある）。 */
  charge_id?: string | null;
  /** Stripe の決済手数料（Stripe 同期の行にだけある）。 */
  fee?: number | null;
  /** 請求の種類（Webhook の行にだけある）。subscription_cycle / subscription_create が毎月の定期課金。 */
  billing_reason?: string | null;
  /** 支払った人（Webhook の行にだけある）。請求のメールアドレス、無ければ Stripe の顧客ID。 */
  payer?: string | null;
};
export type BookingRow = { booked_at: string; status: string };

/** いま Stripe で有効な一口支援（定期課金）。当月の「一口支援の月額」に使う。 */
export type LiveSupport = {
  ym: string;
  yen: number;
  supporters: number;
  units: number;
  /** 支払いが遅れている定期課金の月額。yen には含めない。 */
  pastDueYen: number;
};

export type ReportSource = {
  customers: CustomerRow[];
  contracts: ContractRow[];
  supports: SupportRow[];
  horses: HorseRow[];
  donations: DonationRow[];
  payments: PaymentRow[];
  bookings: BookingRow[];
  hiddenEmails?: readonly string[];
  /** 請求明細を読み込んである期間の始まり（ISO）。これ以降の終わった月は、一口支援を Stripe の課金から数える。 */
  linesSince?: string | null;
  liveSupport?: LiveSupport | null;
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

/** 「会員種別と一口支援の推移」の行。画面の表と、過去分のダウンロードで同じ並びにする。 */
export const TREND_ROWS = [
  { key: "total", label: "会員数", unit: "名" },
  { key: "free", label: "無料会員", unit: "名" },
  { key: "members", label: "メンバーズ会員", unit: "名" },
  { key: "supportersPlan", label: "サポーター会員", unit: "名" },
  { key: "relief", label: "リェリーフ会員", unit: "名" },
  { key: "shareSupporters", label: "一口支援者数", unit: "名" },
  { key: "shareUnits", label: "一口支援数", unit: "口" },
] as const satisfies ReadonlyArray<{ key: keyof ClassCounts; label: string; unit: string }>;

/** 推移の表の 1 か月分。画面では今月・前月・前々月の順に並べる。 */
export type TrendMonth = {
  ym: string;
  /** 月末の数。会員サイトで集計を始める前の月は null（「—」と表示する）。 */
  counts: ClassCounts | null;
  /** 前月比の比較先（その前の月の数）。比較先が集計を始める前の月なら null。 */
  before: ClassCounts | null;
};

export type HorseChange = {
  id: string;
  name: string;
  units: number;
  previousUnits: number;
  deltaUnits: number;
};

export type SystemIncome = {
  donationCard: number;
  donationBank: number;
  duesYen: number;
  shareIncomeYen: number;
  incomeYen: number;
};

/**
 * 会員に公開する数字（決済報告）に入れる、手入力の調整。
 * システム計算はカードの決済額（手数料を引く前）で、銀行振込・口座引落の一口支援や、申告のない直接振込の寄付は入っていない。
 * 手数料は引き、銀行振込などは足す。足す側はマイナスも入れられる。
 */
export type Adjustments = {
  donationFeeYen: number;
  donationExtraYen: number;
  duesFeeYen: number;
  duesExtraYen: number;
  shareFeeYen: number;
  shareExtraYen: number;
  /** 売却・譲渡した頭数。null は自動（名前に「オーナー決定」とある馬の数）。 */
  soldHorses: number | null;
};

export const ADJUST_ROWS = [
  { key: "donation", label: "単発寄付", fee: "donationFeeYen", extra: "donationExtraYen", extraHint: "システムに申告のない、直接振込の寄付" },
  { key: "dues", label: "会費収入", fee: "duesFeeYen", extra: "duesExtraYen", extraHint: "銀行振込などで受けた会費" },
  { key: "share", label: "一口支援", fee: "shareFeeYen", extra: "shareExtraYen", extraHint: "銀行振込・口座引落で受けた一口支援" },
] as const;

export type AdjustRowKey = (typeof ADJUST_ROWS)[number]["key"];

export type MonthReport = {
  ym: string;
  label: string;
  counts: ClassCounts;
  previous: ClassCounts;
  yearAgo: ClassCounts;
  /** 推移の表に出す、今月・前月・前々月の数と、それぞれの前月比の比較先。 */
  trend: TrendMonth[];
  newMembers: number;
  withdrawn: number;
  averageSupportYen: number;
  donations: { card: number; bank: number; total: number };
  /** 会費収入。メンバーズ・サポーター・リェリーフに、リタポ・特別チーム（teamIncomeYen）を含めた額。 */
  duesYen: number;
  teamIncomeYen: number;
  shareIncomeYen: number;
  /** 会費にも一口支援にも振り分けられなかった定期入金。通常は 0。 */
  otherIncomeYen: number;
  incomeYen: number;
  operatingYen: number;
  careYen: number;
  /** 預託中の頭数。保護馬（rescuedHorses）から、売却・譲渡した馬（soldHorses）を引いた数。 */
  boardingHorses: number;
  boardingYen: number;
  rescuedHorses: number;
  soldHorses: number;
  /** 頭数を手入力しないときに使う数。保護馬は故を除く登録数、売却は名前に「オーナー決定」とある数。 */
  horseDefaults: { rescued: number; sold: number };
  /** 手入力の調整を入れる前の、会員サイトの記録から計算した収入。 */
  system: SystemIncome;
  /** donations・duesYen・shareIncomeYen・incomeYen に反映済みの、手入力の調整。 */
  adjust: Adjustments;
  /** Stripe の残高レポートと同じ数え方の、その月の集計（決済・返金・手数料）。 */
  stripe: StripeMonth;
  /**
   * 一口支援の月額・支援者数・口数（counts の supportYen / shareSupporters / shareUnits）の出どころ。
   * billed = その月に Stripe が課金した定期課金、live = いま Stripe で有効な定期課金、registered = サイトの登録。
   */
  supportBasis: SupportBasis;
  /** 支払いが遅れている定期課金の月額（live のときだけ）。 */
  supportPastDueYen: number;
  /** サイトに登録されている支援から数えた月末の数字。Stripe と違うときの照合に使う。 */
  registered: { supportYen: number; shareSupporters: number; shareUnits: number };
  eventBookings: number;
  horsesUp: HorseChange[];
  horsesDown: HorseChange[];
  /** 比較先の月がシステム開始より前のときは false。前月比・前年同月比を「—」にする。 */
  comparable: { previous: boolean; yearAgo: boolean };
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

export function emptyAdjustments(): Adjustments {
  return { donationFeeYen: 0, donationExtraYen: 0, duesFeeYen: 0, duesExtraYen: 0, shareFeeYen: 0, shareExtraYen: 0, soldHorses: null };
}

/** 保存値・入力値を調整に直す。手数料は 0 以上、足す側は符号つき、頭数は空なら自動（null）。 */
export function parseAdjustments(raw: unknown): Adjustments {
  const base = emptyAdjustments();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  const yen = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };
  for (const row of ADJUST_ROWS) {
    base[row.fee] = Math.max(0, yen(src[row.fee]));
    base[row.extra] = yen(src[row.extra]);
  }
  const sold = src.soldHorses;
  if (sold != null && sold !== "") {
    const n = Number(sold);
    if (Number.isFinite(n) && n >= 0) base.soldHorses = Math.round(n);
  }
  return base;
}

export function hasIncomeAdjustments(adjust: Adjustments): boolean {
  return ADJUST_ROWS.some((row) => adjust[row.fee] !== 0 || adjust[row.extra] !== 0);
}

/**
 * システム計算の収入に手入力の調整を入れて、公開する金額にする。
 * 単発寄付は、手数料をカードの分から引き、直接振込の分を振込に足す。
 */
export function adjustIncome(system: SystemIncome, adjust: Adjustments) {
  const card = system.donationCard - adjust.donationFeeYen;
  const bank = system.donationBank + adjust.donationExtraYen;
  const duesYen = system.duesYen - adjust.duesFeeYen + adjust.duesExtraYen;
  const shareIncomeYen = system.shareIncomeYen - adjust.shareFeeYen + adjust.shareExtraYen;
  const otherIncomeYen = system.incomeYen - system.donationCard - system.donationBank - system.duesYen - system.shareIncomeYen;
  return {
    donations: { card, bank, total: card + bank },
    duesYen,
    shareIncomeYen,
    incomeYen: card + bank + duesYen + shareIncomeYen + otherIncomeYen,
  };
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
  const present = source.customers.filter((c) => {
    if (hiddenIds.has(c.id)) return false;
    if (c.status === "withdrawn") {
      const updated = new Date(c.updated_at).getTime();
      if (Number.isFinite(updated) && updated < endMs) return false;
    }
    return true;
  });
  const alive = present.filter((c) => {
    const joined = new Date(c.joined_at ?? c.created_at).getTime();
    return Number.isFinite(joined) && joined < endMs;
  });
  const aliveIds = new Set(alive.map((c) => c.id));
  // 支援は、会員サイトへの入会日より前から続いていることがある（旧サイトから引き継いだ支援に、後から会員登録が付いた場合）。
  // Stripe ではその月も課金されているので、支援は入会日ではなく、支援そのものの開始日・終了日で数える。
  const supporterIds = new Set(present.map((c) => c.id));

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
    if (!supporterIds.has(support.customer_id)) continue;
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

/**
 * Stripe を通らない寄付（銀行振込、または決済の記録なしに手作業で入金済みにしたもの）。着金を確認した日で数える。
 * カードで決済された寄付は Stripe の決済から数えるので、ここには入れない（入れると二重になる）。
 */
function offlineDonations(donations: DonationRow[], startMs: number, endMs: number): number {
  let total = 0;
  for (const row of donations) {
    if (row.status !== "succeeded") continue;
    if (row.payment_method !== "bank_transfer" && row.payment_intent_id) continue;
    if (inMonth(row.confirmed_at ?? row.donated_at, startMs, endMs)) total += Number(row.amount) || 0;
  }
  return total;
}

export function incomeKindOfPlan(code: string | null | undefined): IncomeKind | null {
  if (code === "SUPPORT") return "share";
  if (code === "RPT" || code === "SPECIAL_TEAM") return "team";
  if (code === "A" || code === "B" || code === "C" || code === "OWNER") return "dues";
  return null;
}

/**
 * Stripe の請求明細 1 行の振り分け。プランが引けない料金（旧サイト時代の料金、馬ごとに作る支援の料金）は品名で見る。
 * 「Retouchメンバーズ 半口支援馬会員」のように会員と支援の両方の語を含む品名があるので、支援を先に判定する。
 */
export function incomeKindOfLine(description: string | null | undefined, planCode?: string | null): IncomeKind {
  const byPlan = incomeKindOfPlan(planCode);
  if (byPlan) return byPlan;
  const text = description ?? "";
  if (/口支援|支援馬|半口/.test(text)) return "share";
  if (/チーム|RPT|リタポ|Pony/i.test(text)) return "team";
  if (/会員|メンバー/.test(text)) return "dues";
  return "other";
}

export type Refund = { at: number; amount: number };

/**
 * Stripe の支払い 1 件。金額の数え方は Stripe の残高レポートに合わせる：
 * 決済は決済された日に決済額のまま数え、返金は返金した日に引き、手数料は別に持つ。
 */
export type Receipt = {
  at: number;
  /** 決済額（返金・手数料を引く前）。区分ごとの内訳（dues / team / share / other）の合計と一致する。寄付は内訳を持たない。 */
  amount: number;
  /** Stripe の決済手数料。記録が無いときは 0。 */
  fee: number;
  /** 手数料の記録があるか（2026-10 より前に同期した行には無い）。 */
  feeKnown: boolean;
  refunds: Refund[];
  /** 毎月の定期課金。口数変更の日割りなどは false。 */
  regular: boolean;
  /** 支払った人（請求の記録にだけある）。請求のメールアドレス、無ければ Stripe の顧客ID。 */
  payer: string | null;
  /** 寄付として記録された単発の決済。 */
  donation: boolean;
} & Record<IncomeKind, number>;

const INCOME_KINDS: IncomeKind[] = ["dues", "team", "share", "other"];

function splitByKind(amount: number, lines: PaymentLine[], fallback: IncomeKind): Record<IncomeKind, number> {
  const out: Record<IncomeKind, number> = { dues: 0, team: 0, share: 0, other: 0 };
  const sums: Record<IncomeKind, number> = { dues: 0, team: 0, share: 0, other: 0 };
  for (const line of lines) sums[line.kind] += Number(line.amount) || 0;
  const kinds = INCOME_KINDS.filter((kind) => sums[kind] > 0);
  const total = kinds.reduce((sum, kind) => sum + sums[kind], 0);
  if (total <= 0) {
    out[fallback] = amount;
    return out;
  }
  // 割引や日割りで明細の合計と決済額がずれることがある。決済額を明細の比率で分け、端数は最後の区分に寄せる。
  let rest = amount;
  kinds.forEach((kind, index) => {
    const part = index === kinds.length - 1 ? rest : Math.round((amount * sums[kind]) / total);
    out[kind] = part;
    rest -= part;
  });
  return out;
}

const timeOf = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/**
 * 同じ Stripe の支払いが Webhook と Stripe 同期の2行で入るため、行をそのまま足すと二重になる。
 * key が同じ行を 1 件にまとめ、決済額・手数料・返金を取り出す。成功した決済が無いものは返さない。
 * 返金の明細が無い古い行は、返金額だけ（それも無ければ全額）を、返金日（無ければ決済日）に置く。
 */
function settledGroups(
  payments: PaymentRow[],
  keyOf: (payment: PaymentRow) => string | null | undefined,
): { at: number; amount: number; fee: number; feeKnown: boolean; refunds: Refund[]; rows: PaymentRow[] }[] {
  const groups = new Map<string, PaymentRow[]>();
  payments.forEach((payment, index) => {
    const id = keyOf(payment);
    const key = id ? `id:${id}` : `row:${index}`;
    const rows = groups.get(key);
    if (rows) rows.push(payment);
    else groups.set(key, [payment]);
  });
  const out: { at: number; amount: number; fee: number; feeKnown: boolean; refunds: Refund[]; rows: PaymentRow[] }[] = [];
  for (const rows of groups.values()) {
    const settled = rows.filter((row) => row.status === "succeeded" || row.status === "refunded");
    const times = settled.map((row) => timeOf(row.occurred_at)).filter(Number.isFinite);
    if (times.length === 0) continue;
    // 決済日時は Stripe の決済の行のもの。Webhook の控えは、寄付だと決済画面を開いた時刻で、日付をまたぐことがある。
    const chargeTimes = settled.filter((row) => row.charge_id).map((row) => timeOf(row.occurred_at)).filter(Number.isFinite);
    const at = Math.min(...(chargeTimes.length > 0 ? chargeTimes : times));
    const amount = Math.max(...settled.map((row) => Number(row.amount) || 0));
    // 0円の請求は Stripe では決済が起きない。支払いとして数えない。
    if (amount <= 0) continue;
    const fees = rows.map((row) => row.fee).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    let refunds: Refund[] = rows
      .flatMap((row) => row.refunds ?? [])
      .map((refund) => ({ at: timeOf(refund.at), amount: Number(refund.amount) || 0 }))
      .map((refund) => ({ at: Number.isFinite(refund.at) ? refund.at : at, amount: refund.amount }))
      .filter((refund) => refund.amount > 0);
    const refundedRows = settled.filter((row) => row.status === "refunded");
    if (refunds.length === 0 && refundedRows.length > 0) {
      const known = refundedRows.map((row) => row.refunded_amount).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const total = Math.min(amount, known.length > 0 ? Math.max(...known) : amount);
      const when = refundedRows.map((row) => timeOf(row.refunded_at)).find(Number.isFinite) ?? at;
      if (total > 0) refunds = [{ at: when, amount: total }];
    }
    out.push({ at, amount, fee: fees.length > 0 ? Math.max(...fees) : 0, feeKnown: fees.length > 0, refunds, rows });
  }
  return out;
}

const REGULAR_REASONS = new Set(["subscription_cycle", "subscription_create"]);

/** 定期決済を請求ごとに 1 件にまとめ、会費・一口支援に振り分ける。 */
export function subscriptionReceipts(source: Pick<ReportSource, "payments" | "contracts">): Receipt[] {
  const planByContract = new Map(source.contracts.map((c) => [c.id, c.plan_code]));
  const subscriptions = source.payments.filter((payment) => payment.kind === "subscription");
  return settledGroups(subscriptions, (payment) => payment.invoice_id).map(({ rows, ...group }) => {
    const lines = rows.find((row) => row.lines && row.lines.length > 0)?.lines ?? [];
    const contractId = rows.find((row) => row.contract_id)?.contract_id;
    const fallback = incomeKindOfPlan(contractId ? planByContract.get(contractId) : null) ?? "other";
    const reason = rows.find((row) => row.billing_reason)?.billing_reason ?? null;
    return {
      ...group,
      regular: reason != null && REGULAR_REASONS.has(reason),
      payer: rows.find((row) => row.payer)?.payer ?? null,
      donation: false,
      ...splitByKind(group.amount, lines, fallback),
    };
  });
}

/**
 * Stripe で決済された単発の支払い（決済ごとに 1 件）。カードの寄付がこれに当たる。
 * Stripe の番号を持たない行（銀行振込の寄付を手で入金済みにした行）は Stripe の支払いではないので含めない。
 */
function oneOffReceipts(source: Pick<ReportSource, "payments" | "donations">): Receipt[] {
  const donationIntents = new Set(source.donations.map((row) => row.payment_intent_id).filter((id): id is string => !!id));
  const oneOff = source.payments.filter(
    (payment) => payment.kind !== "subscription" && (payment.payment_intent_id || payment.charge_id),
  );
  return settledGroups(oneOff, (payment) => payment.payment_intent_id ?? payment.charge_id).map(({ rows, ...group }) => {
    const donation = rows.some(
      (row) => row.kind === "donation" || (row.payment_intent_id != null && donationIntents.has(row.payment_intent_id)),
    );
    return {
      ...group,
      regular: false,
      payer: null,
      donation,
      dues: 0,
      team: 0,
      share: 0,
      other: donation ? 0 : group.amount,
    };
  });
}

/** Stripe の支払いの一覧（定期決済は請求ごと、単発は決済ごとに 1 件）。 */
export function stripeReceipts(source: Pick<ReportSource, "payments" | "contracts" | "donations">): Receipt[] {
  return [...subscriptionReceipts(source), ...oneOffReceipts(source)];
}

export type StripeBucket = { grossYen: number; refundYen: number; feeYen: number };
export type StripeKind = IncomeKind | "donation";
const STRIPE_KINDS: StripeKind[] = ["dues", "team", "share", "other", "donation"];

/** total を parts の比率で整数に分ける。端数は最後の区分に寄せるので、合計は必ず total になる。 */
function allocate(total: number, parts: Record<StripeKind, number>): Record<StripeKind, number> {
  const out: Record<StripeKind, number> = { dues: 0, team: 0, share: 0, other: 0, donation: 0 };
  const kinds = STRIPE_KINDS.filter((kind) => parts[kind] > 0);
  const sum = kinds.reduce((acc, kind) => acc + parts[kind], 0);
  if (sum <= 0 || total === 0) return out;
  let rest = total;
  kinds.forEach((kind, index) => {
    const part = index === kinds.length - 1 ? rest : Math.round((total * parts[kind]) / sum);
    out[kind] = part;
    rest -= part;
  });
  return out;
}

function partsOf(receipt: Receipt): Record<StripeKind, number> {
  return {
    dues: receipt.dues,
    team: receipt.team,
    share: receipt.share,
    other: receipt.other,
    donation: receipt.donation ? receipt.amount : 0,
  };
}

export type StripeMonth = {
  /** その月に決済された支払いの件数。 */
  payments: number;
  /** その月に行われた返金の件数。 */
  refunds: number;
  /** 手数料の記録が無い支払いの件数。0 でなければ、手数料の合計は実際より少ない。 */
  feeMissing: number;
  kinds: Record<StripeKind, StripeBucket>;
  total: StripeBucket;
};

/**
 * Stripe の残高レポート（アクティビティによる残高の変更）と同じ数え方の月次集計。
 * 決済はその月に決済された分を決済額のまま、返金はその月に返金した分を、手数料はその月の決済の分を数える。
 */
export function stripeMonth(receipts: Receipt[], startMs: number, endMs: number): StripeMonth {
  const bucket = (): StripeBucket => ({ grossYen: 0, refundYen: 0, feeYen: 0 });
  const month: StripeMonth = {
    payments: 0,
    refunds: 0,
    feeMissing: 0,
    kinds: { dues: bucket(), team: bucket(), share: bucket(), other: bucket(), donation: bucket() },
    total: bucket(),
  };
  for (const receipt of receipts) {
    const parts = partsOf(receipt);
    if (receipt.at >= startMs && receipt.at < endMs) {
      month.payments += 1;
      if (!receipt.feeKnown) month.feeMissing += 1;
      const fees = allocate(receipt.fee, parts);
      for (const kind of STRIPE_KINDS) {
        month.kinds[kind].grossYen += parts[kind];
        month.kinds[kind].feeYen += fees[kind];
      }
      month.total.grossYen += receipt.amount;
      month.total.feeYen += receipt.fee;
    }
    for (const refund of receipt.refunds) {
      if (refund.at < startMs || refund.at >= endMs) continue;
      month.refunds += 1;
      const back = allocate(refund.amount, parts);
      for (const kind of STRIPE_KINDS) month.kinds[kind].refundYen += back[kind];
      month.total.refundYen += refund.amount;
    }
  }
  return month;
}

/** 1口の月額。口数は、定期課金の金額をこれで割って出す。 */
export const SUPPORT_UNIT_YEN = 12_000;

/**
 * その月に Stripe が課金した一口支援（毎月の定期課金）。返金した分は、返金日にかかわらず引く。
 * 口数変更の日割りは月額ではないので含めない。
 */
export function billedSupport(receipts: Receipt[], startMs: number, endMs: number): { yen: number; supporters: number; units: number } {
  let yen = 0;
  const payers = new Set<string>();
  receipts.forEach((receipt, index) => {
    if (!receipt.regular || receipt.share <= 0 || receipt.at < startMs || receipt.at >= endMs) return;
    const refunded = receipt.refunds.reduce((sum, refund) => sum + refund.amount, 0);
    const kept = receipt.share - allocate(Math.min(refunded, receipt.amount), partsOf(receipt)).share;
    if (kept <= 0) return;
    yen += kept;
    payers.add(receipt.payer ?? `receipt:${index}`);
  });
  return { yen, supporters: payers.size, units: Math.round((yen / SUPPORT_UNIT_YEN) * 2) / 2 };
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

/** 売却・譲渡した馬は、名前に「オーナー決定」と付けて登録されている。 */
export function isSoldHorse(name: string): boolean {
  return /オーナー決定|売却|譲渡/.test(name);
}

/** 登録されている馬から数えた頭数。売った月は記録にないので、売却はいまの名前で判定する。 */
function horseDefaultCounts(horses: HorseRow[], endMs: number): { rescued: number; sold: number } {
  const living = horses.filter((h) => {
    const created = new Date(h.created_at).getTime();
    return (!Number.isFinite(created) || created < endMs) && !isDeceasedHorse(h.name);
  });
  return { rescued: living.length, sold: living.filter((h) => isSoldHorse(h.name)).length };
}

export type SupportBasis = "billed" | "live" | "registered";

type MonthCounts = { counts: ClassCounts; basis: SupportBasis; registered: ClassCounts };

/**
 * 月末の人数と一口支援を、月ごとに出す関数を作る。一口支援の金額・人数・口数は Stripe から取る：
 * 終わった月はその月に Stripe が課金した定期課金、当月はいま Stripe で有効な定期課金。
 * Stripe の記録を読み込んでいない月だけ、サイトの登録から数える。
 */
function monthCounter(source: ReportSource, receipts: Receipt[], nowMs: number): (monthYm: string) => MonthCounts {
  const hidden = new Set((source.hiddenEmails ?? []).map((e) => e.trim().toLowerCase()));
  const linesSinceMs = source.linesSince ? new Date(source.linesSince).getTime() : NaN;
  const done = new Map<string, MonthCounts>();
  const count = (monthYm: string): MonthCounts => {
    const point = parseYearMonth(monthYm)!;
    const pointNext = shiftMonth(point.year, point.month, 1);
    const monthStartMs = monthStart(point.year, point.month).getTime();
    const monthEndMs = monthStart(pointNext.year, pointNext.month).getTime();
    const registered = countsAt(source, monthEndMs, hidden);
    const live = source.liveSupport;
    if (live && live.ym === monthYm && monthEndMs > nowMs) {
      return { counts: { ...registered, supportYen: live.yen, shareSupporters: live.supporters, shareUnits: live.units }, basis: "live", registered };
    }
    if (Number.isFinite(linesSinceMs) && monthStartMs >= linesSinceMs && monthEndMs <= nowMs) {
      const billed = billedSupport(receipts, monthStartMs, monthEndMs);
      return { counts: { ...registered, supportYen: billed.yen, shareSupporters: billed.supporters, shareUnits: billed.units }, basis: "billed", registered };
    }
    return { counts: registered, basis: "registered", registered };
  };
  return (monthYm) => {
    const known = done.get(monthYm) ?? count(monthYm);
    done.set(monthYm, known);
    return known;
  };
}

/** 集計を始める前の月は数えない（null）。 */
function trackedCounts(monthCounts: (monthYm: string) => MonthCounts, monthYm: string): ClassCounts | null {
  return monthYm >= SYSTEM_START_YM ? monthCounts(monthYm).counts : null;
}

/**
 * 過去分のダウンロード用。fromYm から toYm までの月ごとの数を、新しい月から順に返す。
 * 数え方は buildMonthReport と同じなので、各月の数は画面でその月を開いたときの「今月」と一致する。
 */
export function buildCountHistory(source: ReportSource, fromYm: string, toYm: string, now: Date = new Date()): TrendMonth[] {
  const from = parseYearMonth(fromYm);
  const to = parseYearMonth(toYm);
  if (!from || !to) return [];
  const monthCounts = monthCounter(source, stripeReceipts(source), now.getTime());
  const months: TrendMonth[] = [];
  for (let point = to; formatYearMonth(point.year, point.month) >= fromYm; point = shiftMonth(point.year, point.month, -1)) {
    const before = shiftMonth(point.year, point.month, -1);
    months.push({
      ym: formatYearMonth(point.year, point.month),
      counts: trackedCounts(monthCounts, formatYearMonth(point.year, point.month)),
      before: trackedCounts(monthCounts, formatYearMonth(before.year, before.month)),
    });
  }
  return months;
}

/**
 * 過去分のダウンロード（CSV）の表。1 行が 1 か月で、区分と前月比は画面の推移の表と同じ。
 * inProgressYm はまだ終わっていない月。その行には、月の途中の数字だと書き添える。
 */
export function countHistoryTable(history: TrendMonth[], inProgressYm: string | null = null): { columns: string[]; rows: Record<string, string | number>[] } {
  const countColumn = (row: (typeof TREND_ROWS)[number]) => `${row.label}（${row.unit}）`;
  const rateColumn = (row: (typeof TREND_ROWS)[number]) => `${row.label} 前月比`;
  const rows = history.flatMap((month) => {
    const counts = month.counts;
    if (!counts) return [];
    const line: Record<string, string | number> = { 月: monthLabel(month.ym) };
    for (const row of TREND_ROWS) {
      line[countColumn(row)] = counts[row.key];
      line[rateColumn(row)] = formatChange(month.before ? changeRate(counts[row.key], month.before[row.key]) : null);
    }
    line["備考"] = month.ym === inProgressYm ? "月の途中の数字" : "";
    return [line];
  });
  return { columns: ["月", ...TREND_ROWS.flatMap((row) => [countColumn(row), rateColumn(row)]), "備考"], rows };
}

export type ManualInput = {
  /** その月の手入力の調整。 */
  adjust?: Adjustments | null;
  /** ほかの月の調整。推移グラフの単発寄付を、各月の公開した数字に合わせる。 */
  adjustByMonth?: ReadonlyMap<string, Adjustments>;
  /** 「終わった月かどうか」を決める現在時刻。テスト用。 */
  now?: Date;
};

/**
 * horseCountOverride は保護馬の頭数（売却・譲渡した馬を含む）の手入力。
 * manual を渡すと、収入と預託の頭数に手入力の調整を入れた「公開する数字」を返す。渡さなければシステム計算のまま。
 */
export function buildMonthReport(
  source: ReportSource,
  ym: string,
  horseCountOverride: number | null = null,
  manual: ManualInput = {},
): MonthReport | null {
  const parsed = parseYearMonth(ym);
  if (!parsed) return null;
  const hidden = new Set((source.hiddenEmails ?? []).map((e) => e.trim().toLowerCase()));
  const start = monthStart(parsed.year, parsed.month);
  const next = shiftMonth(parsed.year, parsed.month, 1);
  const previousMonth = shiftMonth(parsed.year, parsed.month, -1);
  const yearAgo = shiftMonth(parsed.year, parsed.month, -12);
  const startMs = start.getTime();
  const endMs = monthStart(next.year, next.month).getTime();
  const prevEndMs = startMs;
  const nowMs = (manual.now ?? new Date()).getTime();
  const receipts = stripeReceipts(source);

  const monthCounts = monthCounter(source, receipts, nowMs);
  const monthBack = (back: number) => {
    const point = shiftMonth(parsed.year, parsed.month, -back);
    return formatYearMonth(point.year, point.month);
  };
  const current = monthCounts(ym);
  const counts = current.counts;
  const previous = monthCounts(monthBack(1)).counts;
  const yearAgoCounts = monthCounts(monthBack(12)).counts;
  // 推移の表は今月・前月・前々月。前々月の前月比には、もう 1 か月前の数を使う。
  const trend: TrendMonth[] = [0, 1, 2].map((back) => ({
    ym: monthBack(back),
    counts: back === 0 ? counts : trackedCounts(monthCounts, monthBack(back)),
    before: trackedCounts(monthCounts, monthBack(back + 1)),
  }));

  const adjust = manual.adjust ?? emptyAdjustments();
  // 収入は Stripe の残高レポートと同じ数え方：その月に決済された額から、その月に返金した額を引く。手数料は引かない。
  const stripe = stripeMonth(receipts, startMs, endMs);
  const netOf = (kind: StripeKind) => stripe.kinds[kind].grossYen - stripe.kinds[kind].refundYen;
  const teamIncomeYen = netOf("team");
  const otherIncomeYen = netOf("other");
  const donationBank = offlineDonations(source.donations, startMs, endMs);
  const system: SystemIncome = {
    donationCard: netOf("donation"),
    donationBank,
    duesYen: netOf("dues") + teamIncomeYen,
    shareIncomeYen: netOf("share"),
    incomeYen: netOf("donation") + donationBank + netOf("dues") + teamIncomeYen + netOf("share") + otherIncomeYen,
  };
  const incomeParts = { teamIncomeYen, otherIncomeYen };
  const adjusted = adjustIncome(system, adjust);
  const incomeYen = adjusted.incomeYen;
  const operatingYen = Math.round(incomeYen * OPERATING_EXPENSE_RATE);
  const careYen = incomeYen - operatingYen;

  const horseDefaults = horseDefaultCounts(source.horses, endMs);
  const rescuedHorses =
    horseCountOverride != null && Number.isFinite(horseCountOverride) && horseCountOverride >= 0
      ? Math.round(horseCountOverride)
      : horseDefaults.rescued;
  const soldHorses = Math.min(rescuedHorses, adjust.soldHorses ?? horseDefaults.sold);
  const boardingHorses = rescuedHorses - soldHorses;
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

  // 推移グラフはシステム開始月から。それより前の月は会員サイトの記録がそろっていない。
  const series = [];
  for (let i = 5; i >= 0; i--) {
    const point = shiftMonth(parsed.year, parsed.month, -i);
    if (i > 0 && formatYearMonth(point.year, point.month) < SYSTEM_START_YM) continue;
    const pointNext = shiftMonth(point.year, point.month, 1);
    const pointStart = monthStart(point.year, point.month).getTime();
    const pointEnd = monthStart(pointNext.year, pointNext.month).getTime();
    const pointYm = formatYearMonth(point.year, point.month);
    const pointCounts = i === 0 ? counts : monthCounts(pointYm).counts;
    const pointStripe = i === 0 ? stripe : stripeMonth(receipts, pointStart, pointEnd);
    const pointCard = pointStripe.kinds.donation.grossYen - pointStripe.kinds.donation.refundYen;
    const pointAdjust = i === 0 ? adjust : manual.adjustByMonth?.get(pointYm);
    series.push({
      ym: pointYm,
      label: `${point.month}月`,
      members: pointCounts.total,
      supportYen: pointCounts.supportYen,
      donationYen:
        pointCard + offlineDonations(source.donations, pointStart, pointEnd) - (pointAdjust?.donationFeeYen ?? 0) + (pointAdjust?.donationExtraYen ?? 0),
    });
  }

  return {
    ym,
    label: monthLabel(ym),
    counts,
    previous,
    yearAgo: yearAgoCounts,
    trend,
    newMembers,
    withdrawn,
    averageSupportYen: counts.shareSupporters > 0 ? Math.round(counts.supportYen / counts.shareSupporters) : 0,
    donations: adjusted.donations,
    duesYen: adjusted.duesYen,
    teamIncomeYen: incomeParts.teamIncomeYen,
    shareIncomeYen: adjusted.shareIncomeYen,
    otherIncomeYen: incomeParts.otherIncomeYen,
    incomeYen,
    operatingYen,
    careYen,
    boardingHorses,
    boardingYen: boardingHorses * BOARDING_PER_HORSE_YEN,
    rescuedHorses,
    soldHorses,
    horseDefaults,
    system,
    adjust,
    stripe,
    supportBasis: current.basis,
    supportPastDueYen: current.basis === "live" ? source.liveSupport?.pastDueYen ?? 0 : 0,
    registered: {
      supportYen: current.registered.supportYen,
      shareSupporters: current.registered.shareSupporters,
      shareUnits: current.registered.shareUnits,
    },
    eventBookings,
    horsesUp: up,
    horsesDown: down,
    comparable: {
      previous: formatYearMonth(previousMonth.year, previousMonth.month) >= SYSTEM_START_YM,
      yearAgo: formatYearMonth(yearAgo.year, yearAgo.month) >= SYSTEM_START_YM,
    },
    series,
  };
}
