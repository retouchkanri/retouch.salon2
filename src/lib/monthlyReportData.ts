import { fetchAllRows } from "@/lib/fetchAll";
import { HIDDEN_ACCOUNT_EMAILS } from "@/lib/hiddenAccounts";
import {
  buildMonthReport,
  parseExpenses,
  type BookingRow,
  type ContractRow,
  type CustomerRow,
  type DonationRow,
  type ExpenseMap,
  type HorseRow,
  type MonthReport,
  type PaymentRow,
  type ReportSource,
  type SupportRow,
} from "@/lib/monthlyReport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type SavedReport = {
  year_month: string;
  expenses: ExpenseMap;
  horse_count: number | null;
  note: string;
  published_at: string | null;
  snapshot: PublishedSnapshot | null;
};

export type PublishedSnapshot = {
  report: MonthReport;
  expenses: ExpenseMap;
  note: string;
};

export type ReportBundle = {
  report: MonthReport | null;
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

export async function loadReportSource(admin: Admin): Promise<{ source: ReportSource; error: string | null }> {
  const [customers, contracts, supports, horses, donations, payments, bookings] = await Promise.all([
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
      admin.from("horses").select("id, name, created_at").order("id").range(from, to),
    ),
    fetchAllRows<DonationRow>((from, to) =>
      admin
        .from("donations")
        .select("amount, status, payment_method, donated_at, confirmed_at")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<PaymentRow>((from, to) =>
      admin
        .from("payments")
        .select("amount, status, kind, occurred_at, contract_id")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<BookingRow>((from, to) =>
      admin.from("bookings").select("booked_at, status").order("id").range(from, to),
    ),
  ]);

  const failed = [customers, contracts, supports, horses, donations, payments, bookings].find((r) => r.error);
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
      payments: payments.rows,
      bookings: bookings.rows,
      hiddenEmails: HIDDEN_ACCOUNT_EMAILS,
    },
    error: failed?.error?.message ?? null,
  };
}

function asSnapshot(value: unknown): PublishedSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snap = value as PublishedSnapshot;
  if (!snap.report || typeof snap.report.ym !== "string") return null;
  return { report: snap.report, expenses: parseExpenses(snap.expenses), note: snap.note ?? "" };
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
      note: (data.note as string | null) ?? "",
      published_at: (data.published_at as string | null) ?? null,
      snapshot: asSnapshot(data.snapshot),
    },
    tableMissing: false,
    error: null,
  };
}

export async function loadReportBundle(ym: string): Promise<ReportBundle> {
  const admin = createSupabaseAdminClient();
  const [sourceResult, savedResult] = await Promise.all([loadReportSource(admin), loadSavedReport(admin, ym)]);
  const report = sourceResult.error
    ? null
    : buildMonthReport(sourceResult.source, ym, savedResult.saved?.horse_count ?? null);
  return {
    report,
    saved: savedResult.saved,
    tableMissing: savedResult.tableMissing,
    loadError: sourceResult.error ?? (savedResult.tableMissing ? null : savedResult.error),
  };
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
    rows: (data ?? [])
      .filter((row) => row.published_at)
      .map((row) => ({ year_month: row.year_month as string, published_at: row.published_at as string })),
    tableMissing: false,
  };
}
