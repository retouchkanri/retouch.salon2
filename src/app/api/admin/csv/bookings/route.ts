import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toCsv } from "@/lib/csv";
import { fetchAllRows } from "@/lib/fetchAll";

const EXPORT_COLUMNS = [
  "booking_id",
  "event_id",
  "event_title",
  "event_type",
  "event_starts_at",
  "customer_id",
  "customer_name",
  "customer_email",
  "party_size",
  "status",
  "booked_at",
  "canceled_at",
  "note",
];

export async function GET(req: Request) {
  await requireCapability("csv");
  const url = new URL(req.url);
  const eventId = url.searchParams.get("event_id");

  const admin = createSupabaseAdminClient();
  // PostgREST の 1000 行上限があるため .limit(50000) は効かない。全件出力するには
  // ページングが必須（booked_at は重複しうるので id を第2ソートキーに置く）。
  const { rows: records, error } = await fetchAllRows<any>((from, to) => {
    let query = admin
      .from("bookings")
      .select(
        "id, event_id, party_size, status, booked_at, canceled_at, note, " +
          "customer_id, customer:customers(full_name, email), event:events(title, type, starts_at)",
      )
      .order("booked_at", { ascending: false })
      .order("id", { ascending: true });
    if (eventId) query = query.eq("event_id", eventId);
    return query.range(from, to);
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = records.map((b: any) => ({
    booking_id: b.id,
    event_id: b.event_id,
    event_title: b.event?.title ?? "",
    event_type: b.event?.type ?? "",
    event_starts_at: b.event?.starts_at ?? "",
    customer_id: b.customer_id,
    customer_name: b.customer?.full_name ?? "",
    customer_email: b.customer?.email ?? "",
    party_size: b.party_size,
    status: b.status,
    booked_at: b.booked_at ?? "",
    canceled_at: b.canceled_at ?? "",
    note: b.note ?? "",
  }));

  const csv = toCsv(rows, EXPORT_COLUMNS);
  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bookings_${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
