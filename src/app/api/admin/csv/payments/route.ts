import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toCsv } from "@/lib/csv";
import { fetchAllRows } from "@/lib/fetchAll";

const EXPORT_COLUMNS = [
  "payment_id",
  "occurred_at",
  "customer_id",
  "customer_name",
  "customer_email",
  "kind",
  "amount",
  "currency",
  "payment_method",
  "description",
  "status",
  "refund_date",
  "failure_reason",
  "stripe_invoice_id",
  "stripe_payment_intent_id",
  "stripe_charge_id",
];

function pmLabel(raw: any): string {
  const brand = raw?.brand as string | null;
  const last4 = raw?.last4 as string | null;
  if (!brand && !last4) return "";
  const b = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "card";
  return last4 ? `${b} ****${last4}` : b;
}

export async function GET() {
  await requireCapability("csv");
  const admin = createSupabaseAdminClient();
  // PostgREST は 1 レスポンスあたり 1000 行が上限で .limit(50000) は効かない。
  // payments は 16,000 行を超えるため、ページングしないと大半が欠落する。
  // occurred_at だけではページ境界が不安定なので id を第2ソートキーに置く。
  const { rows: records, error } = await fetchAllRows<any>((from, to) =>
    admin
      .from("payments")
      .select(
        "id, occurred_at, customer_id, kind, amount, currency, status, failure_reason, " +
          "stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id, raw, " +
          "customer:customers(full_name, email)",
      )
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = records.map((r: any) => ({
    payment_id: r.id,
    occurred_at: r.occurred_at ?? "",
    customer_id: r.customer_id ?? "",
    customer_name: r.customer?.full_name ?? r.raw?.stripe_name ?? "",
    customer_email: r.customer?.email ?? r.raw?.stripe_email ?? "",
    kind: r.kind ?? "",
    amount: r.amount ?? 0,
    currency: r.currency ?? "jpy",
    payment_method: pmLabel(r.raw),
    description: r.raw?.description ?? "",
    status: r.status ?? "",
    refund_date: r.raw?.refunded_at ?? "",
    failure_reason: r.failure_reason ?? "",
    stripe_invoice_id: r.stripe_invoice_id ?? "",
    stripe_payment_intent_id: r.stripe_payment_intent_id ?? "",
    stripe_charge_id: r.stripe_charge_id ?? "",
  }));

  const csv = toCsv(rows, EXPORT_COLUMNS);
  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payments_${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
