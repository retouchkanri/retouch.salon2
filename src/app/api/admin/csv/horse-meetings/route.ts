import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toCsv } from "@/lib/csv";
import {
  horseMeetingArrivalLabel,
  horseMeetingFacilityLabel,
  horseMeetingStatusLabel,
} from "@/lib/horseMeetings";
import { fetchAllRows } from "@/lib/fetchAll";

const EXPORT_COLUMNS = [
  "request_id",
  "requested_at",
  "customer_id",
  "customer_name",
  "customer_email",
  "applicant_name",
  "facility",
  "party_size",
  "preferred_date",
  "preferred_time_slot",
  "supported_horses",
  "arrival_method",
  "pickup_time",
  "note",
  "status",
  "admin_note",
  "canceled_at",
];

export async function GET(req: Request) {
  await requireCapability("csv");
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const admin = createSupabaseAdminClient();
  // PostgREST の 1000 行上限があるため .limit(50000) は効かない。全件出力するには
  // ページングが必須（requested_at は重複しうるので id を第2ソートキーに置く）。
  const { rows: records, error } = await fetchAllRows<any>((from, to) => {
    let query = admin
      .from("horse_meeting_requests")
      .select("*, customer:customers(full_name, email)")
      .order("requested_at", { ascending: false })
      .order("id", { ascending: true });
    if (status) query = query.eq("status", status);
    return query.range(from, to);
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = records.map((r: any) => ({
    request_id: r.id,
    requested_at: r.requested_at ?? "",
    customer_id: r.customer_id,
    customer_name: r.customer?.full_name ?? "",
    customer_email: r.customer?.email ?? "",
    applicant_name: r.applicant_name,
    facility: horseMeetingFacilityLabel(r.facility),
    party_size: r.party_size,
    preferred_date: r.preferred_date ?? "",
    preferred_time_slot: r.preferred_time_slot ?? "",
    supported_horses: r.supported_horses ?? "",
    arrival_method: horseMeetingArrivalLabel(r.arrival_method, r.pickup_time),
    pickup_time: r.pickup_time ?? "",
    note: r.note ?? "",
    status: horseMeetingStatusLabel(r.status),
    admin_note: r.admin_note ?? "",
    canceled_at: r.canceled_at ?? "",
  }));

  const csv = toCsv(rows, EXPORT_COLUMNS);
  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="horse_meetings_${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
