import { createSupabaseServerClient } from "./supabase/server";
import { isBasicMemberPlanCode } from "./constraints";
import { fetchAllRows } from "./fetchAll";
import type {
  Booking,
  Contract,
  Customer,
  CustomerSummary,
  Donation,
  EventRow,
  Horse,
  MembershipPlan,
  Payment,
  SpecialTeamMembership,
  SupportSubscription,
} from "@/types/db";

export async function loadCustomer(customerId: string): Promise<Customer | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
  return (data as Customer | null) ?? null;
}

export async function loadCustomerSummary(customerId: string): Promise<CustomerSummary | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("v_customer_summary")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle();
  return (data as CustomerSummary | null) ?? null;
}

export async function loadActiveSupports(customerId: string): Promise<SupportSubscription[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("support_subscriptions")
    .select("*, horse:horses(*)")
    .eq("customer_id", customerId)
    .in("status", ["active", "past_due"])
    .order("started_at", { ascending: false });
  return (data as SupportSubscription[] | null) ?? [];
}

export async function loadActiveSpecialTeam(customerId: string): Promise<SpecialTeamMembership[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("special_team_memberships")
    .select("*, horse:horses(*)")
    .eq("customer_id", customerId)
    .in("status", ["active", "past_due", "incomplete"])
    .order("started_at", { ascending: false });
  // Resilient: if the table has not been migrated yet, do not crash callers.
  if (error) return [];
  return (data as SpecialTeamMembership[] | null) ?? [];
}

export async function loadActiveContract(customerId: string): Promise<Contract | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("contracts")
    .select("*, plan:membership_plans(*)")
    .eq("customer_id", customerId)
    .in("status", ["active", "past_due"])
    .order("started_at", { ascending: false });
  const rows = (data as Contract[] | null) ?? [];
  // 基本会員区分(A/B/C)の契約を優先して返す。リタポ(RPT)・特別チーム(SPECIAL_TEAM)・
  // 支援(SUPPORT) は基本区分ではなく追加・マーカー扱いのため、A/B/C があればそれを採用する。
  // A/B/C が無い場合（ヘルパーズ単独・リタポ単独など）は従来どおり最新契約を返し、
  // ステータス表示等の後方互換を保つ。
  const basic = rows.find((c) => isBasicMemberPlanCode(c.plan?.code ?? ""));
  return basic ?? rows[0] ?? null;
}

export async function loadDonations(customerId: string, limit = 20): Promise<Donation[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("donations")
    .select("*")
    .eq("customer_id", customerId)
    .order("donated_at", { ascending: false })
    .limit(limit);
  return (data as Donation[] | null) ?? [];
}

/** limit に null を渡すと全件（1000 行上限を越えてページング）取得する。 */
export async function loadBookings(customerId: string, limit: number | null = 20): Promise<Booking[]> {
  const supabase = createSupabaseServerClient();
  const base = () =>
    supabase
      .from("bookings")
      .select("*, event:events(*)")
      .eq("customer_id", customerId)
      .order("booked_at", { ascending: false })
      .order("id", { ascending: true });
  if (limit == null) {
    const { rows } = await fetchAllRows<Booking>((from, to) => base().range(from, to));
    return rows;
  }
  const { data } = await base().limit(limit);
  return (data as Booking[] | null) ?? [];
}

/** limit に null を渡すと全件（1000 行上限を越えてページング）取得する。 */
export async function loadPayments(customerId: string, limit: number | null = 20): Promise<Payment[]> {
  const supabase = createSupabaseServerClient();
  const base = () =>
    supabase
      .from("payments")
      .select("*")
      .eq("customer_id", customerId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: true });
  if (limit == null) {
    const { rows } = await fetchAllRows<Payment>((from, to) => base().range(from, to));
    return rows;
  }
  const { data } = await base().limit(limit);
  return (data as Payment[] | null) ?? [];
}

export async function loadHorses(onlySupportable = true): Promise<Horse[]> {
  const supabase = createSupabaseServerClient();
  const query = supabase.from("horses").select("*").order("sort_order", { ascending: true });
  if (onlySupportable) query.eq("is_supportable", true);
  const { data } = await query;
  return (data as Horse[] | null) ?? [];
}

export async function loadPlans(): Promise<MembershipPlan[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("membership_plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return (data as MembershipPlan[] | null) ?? [];
}

export async function loadEvents(onlyUpcoming = true): Promise<EventRow[]> {
  const supabase = createSupabaseServerClient();
  const q = supabase.from("events").select("*").eq("is_published", true).order("starts_at");
  if (onlyUpcoming) q.gte("starts_at", new Date().toISOString());
  const { data } = await q;
  return (data as EventRow[] | null) ?? [];
}
