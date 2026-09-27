import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllByIds } from "@/lib/fetchAll";

export type EventCore = {
  id: string;
  title: string;
  starts_at: string;
  capacity: number;
  supporters_only: boolean;
  is_published: boolean;
};

export type SeatUsage = {
  capacity: number;
  used: number;
  remaining: number;
};

/**
 * Sum reserved/attended seats for a single event. A specific booking can be
 * excluded (used when re-checking capacity for an in-place edit).
 */
export async function seatUsage(
  admin: SupabaseClient,
  event: Pick<EventCore, "id" | "capacity">,
  excludeCustomerId?: string,
): Promise<SeatUsage> {
  const { data } = await admin
    .from("bookings")
    .select("party_size, status, customer_id")
    .eq("event_id", event.id);
  const used = (data ?? []).reduce((acc, b: any) => {
    if (b.status === "canceled") return acc;
    if (excludeCustomerId && b.customer_id === excludeCustomerId) return acc;
    return acc + Number(b.party_size ?? 1);
  }, 0);
  return {
    capacity: event.capacity,
    used,
    remaining: Math.max(0, event.capacity - used),
  };
}

/**
 * Aggregate seat usage for many events at once. Returns a Map keyed by event id.
 */
export async function seatUsageBatch(
  admin: SupabaseClient,
  eventIds: string[],
): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  if (eventIds.length === 0) return used;
  // 予約席数の合計は全件が前提。素のクエリは PostgREST の 1000 行上限で
  // 打ち切られ、残席が実際より多く表示されてしまうためページングする。
  const { rows } = await fetchAllByIds<any>(eventIds, (chunk, from, to) =>
    admin
      .from("bookings")
      .select("event_id, party_size, status")
      .in("event_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  for (const row of rows) {
    const r: any = row;
    if (r.status === "canceled") continue;
    used.set(r.event_id, (used.get(r.event_id) ?? 0) + Number(r.party_size ?? 1));
  }
  return used;
}

/**
 * Check whether a customer has at least one active support subscription.
 * Used to gate `supporters_only` events.
 */
export async function hasActiveSupport(
  admin: SupabaseClient,
  customerId: string,
): Promise<boolean> {
  const { count } = await admin
    .from("support_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("status", "active");
  return Boolean(count && count > 0);
}
