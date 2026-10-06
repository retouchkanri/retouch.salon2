import { fetchAllRows } from "@/lib/fetchAll";
import { HIDDEN_ACCOUNT_EMAILS } from "@/lib/hiddenAccounts";
import { LEGACY_END_YM, asLegacySummary, type LegacySummary } from "@/lib/legacyReport";
import {
  SYSTEM_START_YM,
  buildCountHistory,
  buildMonthReport,
  currentYearMonth,
  formatYearMonth,
  incomeKindOfLine,
  monthStart,
  parseAdjustments,
  parseExpenses,
  parseYearMonth,
  shiftMonth,
  stripeMonth,
  type Adjustments,
  type BookingRow,
  type ContractRow,
  type CustomerRow,
  type DonationRow,
  type ExpenseMap,
  type HorseRow,
  type MonthReport,
  type PaymentLine,
  type PaymentRow,
  type ReportSource,
  type SupportRow,
  type TrendMonth,
} from "@/lib/monthlyReport";
import { loadLiveSupport, loadStripeOtherFees } from "@/lib/stripeLive";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type SavedReport = {
  year_month: string;
  expenses: ExpenseMap;
  /** 保護馬の頭数の手入力（売却・譲渡した馬を含む）。 */
  horse_count: number | null;
  /** 公開する数字に入れる手入力の調整。 */
  adjust: Adjustments;
  note: string;
  published_at: string | null;
  snapshot: PublishedSnapshot | null;
  /** システム開始前のまとめの公開分（LEGACY_END_YM の行だけが持つ）。 */
  legacy: { summary: LegacySummary; note: string } | null;
};

export type PublishedSnapshot = {
  report: MonthReport;
  expenses: ExpenseMap;
  note: string;
};

export type ReportBundle = {
  report: MonthReport | null;
  /** 決済ごとの手数料とは別に Stripe が引いた利用料（Billing・Sigma など）。取れなければ null。 */
  otherStripeFees?: { yen: number; count: number } | null;
  saved: SavedReport | null;
  tableMissing: boolean;
  loadError: string | null;
};

function planCode(value: unknown): string | null {
  const plan = Array.isArray(value) ? value[0] : value;
  if (!plan || typeof plan !== "object" || !("code" in plan)) return null;
  const code = (plan as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return error.code === "42P01" || error.code === "PGRST205" || /monthly_reports/.test(message);
}

type StripeLine = {
  amount?: unknown;
  description?: unknown;
  price?: { id?: unknown } | null;
  plan?: { id?: unknown } | null;
  pricing?: { price_details?: { price?: unknown } | null } | null;
};

function parseLines(raw: unknown, planByPrice: Map<string, string>): PaymentLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const line = item as StripeLine;
    const amount = Number(line.amount);
    if (!Number.isFinite(amount)) return [];
    const price = line.pricing?.price_details?.price ?? line.price?.id ?? line.plan?.id;
    const description = typeof line.description === "string" ? line.description : null;
    return [{ amount, kind: incomeKindOfLine(description, typeof price === "string" ? planByPrice.get(price) : null) }];
  });
}

/** Webhook が保存した請求から取り出す、集計に要る分だけの情報。 */
type InvoiceInfo = { lines: PaymentLine[]; reason: string | null; payer: string | null };

type SlimInvoiceRow = {
  stripe_invoice_id: string;
  reason: string | null;
  payer: string | null;
  email: string | null;
  count: string | null;
  description: string | null;
  amount: string | null;
  price: string | null;
  old_price: string | null;
};

/**
 * 請求（raw）は 1 件が大きいので、明細の 1 行目・請求の種類・顧客だけを取り出して読む。
 * 明細が 2 行以上ある請求（全体の 1% ほど）だけ、明細を丸ごと読み直す。
 * 月の変わり目の秒差に備えて、期間は前後1日広げる。
 */
async function loadInvoices(
  admin: Admin,
  fromMs: number,
  toMs: number,
): Promise<{ invoices: Map<string, InvoiceInfo>; error: { message?: string } | null }> {
  const invoices = new Map<string, InvoiceInfo>();
  const day = 24 * 60 * 60 * 1000;
  const fromIso = new Date(fromMs - day).toISOString();
  const toIso = new Date(toMs + day).toISOString();

  const [plans, slim] = await Promise.all([
    admin.from("membership_plans").select("code, stripe_price_id").not("stripe_price_id", "is", null),
    fetchAllRows<SlimInvoiceRow>((from, to) =>
      admin
        .from("payments")
        .select(
          "stripe_invoice_id, reason:raw->>billing_reason, payer:raw->>customer, email:raw->>customer_email, count:raw->lines->>total_count, " +
            "description:raw->lines->data->0->>description, amount:raw->lines->data->0->>amount, " +
            "price:raw->lines->data->0->pricing->price_details->>price, old_price:raw->lines->data->0->price->>id",
        )
        .eq("kind", "subscription")
        .not("stripe_event_id", "is", null)
        .not("stripe_invoice_id", "is", null)
        .gte("occurred_at", fromIso)
        .lt("occurred_at", toIso)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (plans.error || slim.error) return { invoices, error: plans.error ?? slim.error };

  const planByPrice = new Map<string, string>();
  for (const plan of plans.data ?? []) {
    if (plan.stripe_price_id && plan.code) planByPrice.set(plan.stripe_price_id as string, plan.code as string);
  }

  const multiLine: string[] = [];
  for (const row of slim.rows) {
    // 同じ人が Stripe の顧客を複数持っていることがあるので、支援者の人数はメールアドレスで数える。
    const info: InvoiceInfo = { lines: [], reason: row.reason, payer: row.email?.trim().toLowerCase() || row.payer };
    if (Number(row.count) > 1) {
      multiLine.push(row.stripe_invoice_id);
    } else if (row.amount != null) {
      const price = row.price ?? row.old_price;
      info.lines = [{ amount: Number(row.amount) || 0, kind: incomeKindOfLine(row.description, price ? planByPrice.get(price) : null) }];
    }
    invoices.set(row.stripe_invoice_id, info);
  }

  const ids = [...new Set(multiLine)];
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await admin
      .from("payments")
      .select("stripe_invoice_id, lines:raw->lines->data")
      .not("stripe_event_id", "is", null)
      .in("stripe_invoice_id", ids.slice(index, index + 100));
    if (error) return { invoices, error };
    for (const row of data ?? []) {
      const info = invoices.get(row.stripe_invoice_id as string);
      const lines = parseLines(row.lines, planByPrice);
      if (info && lines.length > 0) info.lines = lines;
    }
  }
  return { invoices, error: null };
}

type PaymentDbRow = {
  amount: number;
  status: string;
  kind: string;
  occurred_at: string;
  contract_id: string | null;
  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  // 以下は Stripe 同期が raw に入れる項目。->> で取るので文字列で返る。
  amount_refunded: string | null;
  refunded_at: string | null;
  fee: string | null;
  refunds: unknown;
};

function parseRefunds(raw: unknown): { amount: number; at: string }[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const refund = item as { amount?: unknown; at?: unknown };
    const amount = Number(refund.amount);
    return Number.isFinite(amount) && typeof refund.at === "string" ? [{ amount, at: refund.at }] : [];
  });
}

/** 推移グラフ（直近6か月）と前年同月比まで Stripe の課金から出すのに、何か月前から請求を読むか。 */
export function reportMonthsBack(ym: string): number {
  const parsed = parseYearMonth(ym);
  if (!parsed) return 1;
  const yearAgo = shiftMonth(parsed.year, parsed.month, -12);
  return `${yearAgo.year}-${String(yearAgo.month).padStart(2, "0")}` >= SYSTEM_START_YM ? 12 : 5;
}

/**
 * ym は収入を出したい月。その月から monthsBack か月前までの請求（明細・種類・顧客）も読み、
 * 会費・一口支援への振り分けと、Stripe が課金した一口支援の月額を出せるようにする。
 */
export async function loadReportSource(
  admin: Admin,
  ym: string = currentYearMonth(),
  monthsBack = 1,
): Promise<{ source: ReportSource; error: string | null }> {
  const parsed = parseYearMonth(ym) ?? parseYearMonth(currentYearMonth())!;
  const first = shiftMonth(parsed.year, parsed.month, -Math.max(1, monthsBack));
  const next = shiftMonth(parsed.year, parsed.month, 1);
  // 会員サイトの Webhook が全部の請求を記録し始めたのは開始月から。それより前は読まない。
  const start = parseYearMonth(SYSTEM_START_YM)!;
  const linesFromMs = Math.max(monthStart(first.year, first.month).getTime(), monthStart(start.year, start.month).getTime());
  const linesToMs = monthStart(next.year, next.month).getTime();
  // 返金は、元の決済が会費か一口支援かで区分に分ける。前の月に決済したものを返金することがあるので、
  // 請求そのものは2か月さかのぼって読む（一口支援の月額を出すのは linesFromMs から）。
  const refundBack = shiftMonth(first.year, first.month, -2);
  const invoicesFromMs = monthStart(refundBack.year, refundBack.month).getTime();

  const [customers, contracts, supports, horses, donations, payments, bookings, invoiceInfo] = await Promise.all([
    fetchAllRows<CustomerRow>((from, to) =>
      admin.from("customers").select("id, email, status, joined_at, created_at, updated_at").order("id").range(from, to),
    ),
    fetchAllRows<ContractRow & { plan?: unknown }>((from, to) =>
      admin
        .from("contracts")
        .select("id, customer_id, started_at, canceled_at, status, plan:membership_plans(code)")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<SupportRow>((from, to) =>
      admin
        .from("support_subscriptions")
        .select("customer_id, horse_id, units, monthly_amount, started_at, canceled_at, status")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<HorseRow>((from, to) =>
      admin.from("horses").select("id, name, created_at, is_supportable").order("id").range(from, to),
    ),
    fetchAllRows<DonationRow>((from, to) =>
      admin
        .from("donations")
        .select("amount, status, payment_method, donated_at, confirmed_at, payment_intent_id:stripe_payment_intent_id")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<PaymentDbRow>((from, to) =>
      admin
        .from("payments")
        .select(
          "amount, status, kind, occurred_at, contract_id, stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id, " +
            "amount_refunded:raw->>amount_refunded, refunded_at:raw->>refunded_at, fee:raw->>fee, refunds:raw->refunds",
        )
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<BookingRow>((from, to) =>
      admin.from("bookings").select("booked_at, status").order("id").range(from, to),
    ),
    loadInvoices(admin, invoicesFromMs, linesToMs),
  ]);

  const failed = [customers, contracts, supports, horses, donations, payments, bookings, invoiceInfo].find((r) => r.error);
  return {
    source: {
      customers: customers.rows,
      contracts: contracts.rows.map((row) => ({
        id: row.id,
        customer_id: row.customer_id,
        started_at: row.started_at,
        canceled_at: row.canceled_at,
        status: row.status,
        plan_code: planCode(row.plan),
      })),
      supports: supports.rows,
      horses: horses.rows,
      donations: donations.rows,
      payments: payments.rows.map((row): PaymentRow => {
        const invoice = row.stripe_invoice_id ? invoiceInfo.invoices.get(row.stripe_invoice_id) ?? null : null;
        // 決済の行（決済IDあり）だけが、手数料と返金を持つ。Webhook が保存した請求にも同じ名前の項目はない。
        const charge = row.stripe_charge_id != null;
        return {
          amount: row.amount,
          status: row.status,
          kind: row.kind,
          occurred_at: row.occurred_at,
          contract_id: row.contract_id,
          invoice_id: row.stripe_invoice_id,
          payment_intent_id: row.stripe_payment_intent_id,
          charge_id: row.stripe_charge_id,
          refunded_amount: charge && row.amount_refunded != null ? Number(row.amount_refunded) : null,
          refunded_at: charge ? row.refunded_at : null,
          refunds: charge ? parseRefunds(row.refunds) : null,
          fee: charge && row.fee != null ? Number(row.fee) : null,
          lines: invoice?.lines.length ? invoice.lines : null,
          billing_reason: invoice?.reason ?? null,
          payer: invoice?.payer ?? null,
        };
      }),
      bookings: bookings.rows,
      hiddenEmails: HIDDEN_ACCOUNT_EMAILS,
      linesSince: new Date(linesFromMs).toISOString(),
    },
    error: failed?.error?.message ?? null,
  };
}

function monthsBefore(ym: string, back: number): string {
  const parsed = parseYearMonth(ym);
  if (!parsed) return ym;
  const point = shiftMonth(parsed.year, parsed.month, -back);
  return formatYearMonth(point.year, point.month);
}

function asSnapshot(value: unknown): PublishedSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snap = value as PublishedSnapshot;
  if (!snap.report || typeof snap.report.ym !== "string") return null;
  // 2026-10 より前の版で公開した分には、後から足した項目がない。画面が落ちないよう既定値で補う。
  const saved = snap.report;
  const comparable = saved.comparable ?? { previous: true, yearAgo: true };
  const report: MonthReport = {
    ...saved,
    teamIncomeYen: saved.teamIncomeYen ?? 0,
    otherIncomeYen: saved.otherIncomeYen ?? 0,
    comparable,
    // 前月・前々月の列を足す前に公開した分に残っているのは、今月と前月の数だけ。
    trend: Array.isArray(saved.trend)
      ? saved.trend
      : [0, 1, 2].map((back) => ({
          ym: monthsBefore(saved.ym, back),
          counts: back === 0 ? saved.counts : back === 1 && comparable.previous ? saved.previous : null,
          before: back === 0 && comparable.previous ? saved.previous : null,
        })),
    rescuedHorses: saved.rescuedHorses ?? saved.boardingHorses,
    soldHorses: saved.soldHorses ?? 0,
    horseDefaults: saved.horseDefaults ?? { rescued: saved.boardingHorses, sold: 0 },
    system: saved.system ?? {
      donationCard: saved.donations.card,
      donationBank: saved.donations.bank,
      duesYen: saved.duesYen,
      shareIncomeYen: saved.shareIncomeYen,
      incomeYen: saved.incomeYen,
    },
    adjust: parseAdjustments(saved.adjust),
    stripe: saved.stripe ?? stripeMonth([], 0, 0),
    supportBasis: saved.supportBasis ?? "registered",
    supportPastDueYen: saved.supportPastDueYen ?? 0,
    registered: saved.registered ?? {
      supportYen: saved.counts.supportYen,
      shareSupporters: saved.counts.shareSupporters,
      shareUnits: saved.counts.shareUnits,
    },
  };
  return { report, expenses: parseExpenses(snap.expenses), note: snap.note ?? "" };
}

/**
 * 手入力の調整は、月ごとの手入力をまとめた expenses 列（JSON）の adjust に入れている。
 * 経費の内訳と同じ「その月に管理者が入れた数字」なので、列は増やしていない。
 */
function savedAdjust(expenses: unknown): Adjustments {
  return parseAdjustments((expenses as { adjust?: unknown } | null)?.adjust);
}

/** 月ごとの手入力の調整。推移グラフの単発寄付を、各月の公開する数字に合わせるのに使う。 */
export async function loadAdjustByMonth(admin: Admin): Promise<Map<string, Adjustments>> {
  const byMonth = new Map<string, Adjustments>();
  const { data } = await admin.from("monthly_reports").select("year_month, expenses");
  for (const row of data ?? []) byMonth.set(row.year_month as string, savedAdjust(row.expenses));
  return byMonth;
}

function asLegacySnapshot(value: unknown): { summary: LegacySummary; note: string } | null {
  if (!value || typeof value !== "object") return null;
  const snap = value as { legacy?: unknown; note?: unknown };
  const summary = asLegacySummary(snap.legacy);
  return summary ? { summary, note: typeof snap.note === "string" ? snap.note : "" } : null;
}

export async function loadSavedReport(admin: Admin, ym: string): Promise<{ saved: SavedReport | null; tableMissing: boolean; error: string | null }> {
  const { data, error } = await admin
    .from("monthly_reports")
    .select("year_month, expenses, horse_count, note, published_at, snapshot")
    .eq("year_month", ym)
    .maybeSingle();
  if (error) {
    return { saved: null, tableMissing: missingTable(error), error: error.message };
  }
  if (!data) return { saved: null, tableMissing: false, error: null };
  return {
    saved: {
      year_month: data.year_month as string,
      expenses: parseExpenses(data.expenses),
      horse_count: data.horse_count == null ? null : Number(data.horse_count),
      adjust: savedAdjust(data.expenses),
      note: (data.note as string | null) ?? "",
      published_at: (data.published_at as string | null) ?? null,
      snapshot: asSnapshot(data.snapshot),
      legacy: asLegacySnapshot(data.snapshot),
    },
    tableMissing: false,
    error: null,
  };
}

/**
 * 経営管理の画面と「会員に公開」で同じ数字になるよう、集計の材料をまとめて読む。
 * 推移グラフの月までの請求、月ごとの手入力、当月なら Stripe でいま有効な一口支援。
 */
export async function loadReportInputs(admin: Admin, ym: string) {
  const [sourceResult, adjustByMonth, liveSupport] = await Promise.all([
    loadReportSource(admin, ym, reportMonthsBack(ym)),
    loadAdjustByMonth(admin),
    // 取れなければ null。そのときはサイトの登録から数える。
    ym === currentYearMonth() ? loadLiveSupport().catch(() => null) : Promise.resolve(null),
  ]);
  return { source: sourceResult.source, error: sourceResult.error, adjustByMonth, liveSupport };
}

export async function loadReportBundle(ym: string): Promise<ReportBundle> {
  const admin = createSupabaseAdminClient();
  const [inputs, savedResult, otherStripeFees] = await Promise.all([
    loadReportInputs(admin, ym),
    loadSavedReport(admin, ym),
    loadStripeOtherFees(ym).catch(() => null),
  ]);
  const { adjustByMonth, liveSupport } = inputs;
  const sourceResult = inputs;
  // 保存済みの手入力（下書き）を入れた、公開する数字。システム計算は report.system に残る。
  const report = sourceResult.error
    ? null
    : buildMonthReport({ ...sourceResult.source, liveSupport }, ym, savedResult.saved?.horse_count ?? null, {
        adjust: savedResult.saved?.adjust,
        adjustByMonth,
      });
  return {
    report,
    otherStripeFees,
    saved: savedResult.saved,
    tableMissing: savedResult.tableMissing,
    loadError: sourceResult.error ?? (savedResult.tableMissing ? null : savedResult.error),
  };
}

/**
 * 過去分のダウンロード用。集計を始めた月から今月までの、月ごとの会員数と一口支援。
 * 請求の明細を開始月から読むので、どの月も経営管理でその月を開いたときと同じ数え方になる。
 */
export async function loadCountHistory(admin: Admin): Promise<{ history: TrendMonth[]; error: string | null }> {
  const ym = currentYearMonth();
  const now = parseYearMonth(ym)!;
  const start = parseYearMonth(SYSTEM_START_YM)!;
  const monthsBack = (now.year - start.year) * 12 + (now.month - start.month);
  const [sourceResult, liveSupport] = await Promise.all([
    loadReportSource(admin, ym, monthsBack),
    // 取れなければ null。そのときはサイトの登録から数える。
    loadLiveSupport().catch(() => null),
  ]);
  if (sourceResult.error) return { history: [], error: sourceResult.error };
  return { history: buildCountHistory({ ...sourceResult.source, liveSupport }, SYSTEM_START_YM, ym), error: null };
}

export async function listPublishedReports(): Promise<{ rows: { year_month: string; published_at: string }[]; tableMissing: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("monthly_reports")
    .select("year_month, published_at")
    .not("published_at", "is", null)
    .order("year_month", { ascending: false });
  if (error) return { rows: [], tableMissing: missingTable(error) };
  return {
    // システム開始前の月で会員に出すのは、開始前のまとめ（LEGACY_END_YM の行）だけ。
    rows: (data ?? [])
      .filter((row) => row.published_at && (row.year_month >= SYSTEM_START_YM || row.year_month === LEGACY_END_YM))
      .map((row) => ({ year_month: row.year_month as string, published_at: row.published_at as string })),
    tableMissing: false,
  };
}
