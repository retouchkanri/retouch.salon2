import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toCsv } from "@/lib/csv";
import { fetchAllRows } from "@/lib/fetchAll";

const EXPORT_COLUMNS = [
  "donation_id",
  "customer_id",
  "customer_email",
  "customer_name",
  "donor_name",
  "donor_email",
  "amount",
  "status",
  "message",
  "donated_at",
];

export async function GET() {
  await requireCapability("csv");
  const admin = createSupabaseAdminClient();
  // PostgREST の 1000 行上限があるため .limit(50000) は効かない。全件出力するには
  // ページングが必須（donated_at は重複しうるので id を第2ソートキーに置く）。
  const { rows: records, error } = await fetchAllRows<any>((from, to) =>
    admin
      .from("donations")
      .select(
        "id, customer_id, donor_name, donor_email, amount, status, message, donated_at, " +
          "customer:customers(email, full_name)",
      )
      .order("donated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = records.map((r: any) => ({
    donation_id: r.id,
    customer_id: r.customer_id ?? "",
    customer_email: r.customer?.email ?? "",
    customer_name: r.customer?.full_name ?? "",
    donor_name: r.donor_name ?? "",
    donor_email: r.donor_email ?? "",
    amount: r.amount,
    status: r.status,
    message: r.message ?? "",
    donated_at: r.donated_at ?? "",
  }));

  const csv = toCsv(rows, EXPORT_COLUMNS);
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="donations_${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
