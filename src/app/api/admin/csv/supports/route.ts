import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { csvToObjects, toCsv } from "@/lib/csv";
import { fetchAllRows } from "@/lib/fetchAll";

const EXPORT_COLUMNS = [
  "support_id",
  "customer_id",
  "customer_email",
  "customer_name",
  "horse_id",
  "horse_name",
  "units",
  "monthly_amount",
  "status",
  "started_at",
  "canceled_at",
];

/**
 * Export all support subscriptions as CSV (joined with customer + horse).
 * Import rows upsert by support_id, or by (customer_email + horse_name)
 * when support_id is empty — useful for bulk migration from the legacy
 * spreadsheet.
 */
export async function GET() {
  await requireCapability("csv");
  const admin = createSupabaseAdminClient();
  // PostgREST の 1000 行上限があるため .limit(50000) は効かない。支援は現在 300 件強で
  // 上限未満だが、増えた時点で無言で欠落するのでページングして全件を出す。
  const { rows: records, error } = await fetchAllRows<any>((from, to) =>
    admin
      .from("support_subscriptions")
      .select(
        "id, customer_id, horse_id, units, monthly_amount, status, started_at, canceled_at, " +
          "customer:customers(email, full_name), horse:horses(name)",
      )
      .order("started_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = records.map((r: any) => ({
    support_id: r.id,
    customer_id: r.customer_id,
    customer_email: r.customer?.email ?? "",
    customer_name: r.customer?.full_name ?? "",
    horse_id: r.horse_id,
    horse_name: r.horse?.name ?? "",
    units: r.units,
    monthly_amount: r.monthly_amount,
    status: r.status,
    started_at: r.started_at ?? "",
    canceled_at: r.canceled_at ?? "",
  }));

  const csv = toCsv(rows, EXPORT_COLUMNS);
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="supports_${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}

export async function POST(req: Request) {
  await requireCapability("csv");
  const fd = await req.formData();
  const file = fd.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "ファイルが添付されていません" }, { status: 400 });
  }
  const text = new TextDecoder("utf-8")
    .decode(await (file as File).arrayBuffer())
    .replace(/^\uFEFF/, "");
  const rows = csvToObjects(text);
  if (rows.length === 0) {
    return NextResponse.json({ error: "データがありません" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  // Pre-resolve support base plan (for per-unit amount fallback)
  const { data: basePlan } = await admin
    .from("membership_plans")
    .select("id, unit_amount")
    .eq("code", "SUPPORT")
    .order("unit_amount", { ascending: true })
    .limit(1)
    .maybeSingle();

  for (const row of rows) {
    try {
      // Resolve customer
      let customerId = row.customer_id || null;
      if (!customerId && row.customer_email) {
        const { data: c } = await admin
          .from("customers")
          .select("id")
          .eq("email", row.customer_email)
          .maybeSingle();
        customerId = (c as any)?.id ?? null;
      }
      if (!customerId) {
        errors.push(`[skip] 顧客が見つかりません: ${row.customer_email ?? row.customer_name ?? "?"}`);
        continue;
      }

      // Resolve horse
      let horseId = row.horse_id || null;
      if (!horseId && row.horse_name) {
        const { data: h } = await admin
          .from("horses")
          .select("id")
          .eq("name", row.horse_name)
          .maybeSingle();
        horseId = (h as any)?.id ?? null;
      }
      if (!horseId) {
        errors.push(`[skip] 馬が見つかりません: ${row.horse_name ?? "?"}`);
        continue;
      }

      const units = Number(row.units || 0);
      if (!(units > 0)) {
        errors.push(`[skip] units が不正: ${JSON.stringify(row)}`);
        continue;
      }
      // Per-口 price is always 12,000円 (half share = units 0.5 → 6,000円).
      // basePlan is the lowest-priced SUPPORT plan (半口=6,000), so it must
      // NOT be used as the per-unit price or half shares get halved twice.
      const perUnit = 12000;
      const monthly = row.monthly_amount
        ? Number(row.monthly_amount)
        : Math.round(perUnit * units);
      const status = ["active", "canceled", "past_due", "paused", "incomplete"].includes(row.status)
        ? row.status
        : "active";

      // Upsert by support_id when provided
      if (row.support_id) {
        const { data: existing } = await admin
          .from("support_subscriptions")
          .select("id")
          .eq("id", row.support_id)
          .maybeSingle();
        if (existing) {
          const { error } = await admin
            .from("support_subscriptions")
            .update({ units, monthly_amount: monthly, status })
            .eq("id", (existing as any).id);
          if (error) errors.push(`[update ${row.support_id}] ${error.message}`);
          else updated += 1;
          continue;
        }
      }

      // Ensure a contract exists
      let contractId: string | null = null;
      const { data: contract } = await admin
        .from("contracts")
        .select("id")
        .eq("customer_id", customerId)
        .in("status", ["active", "past_due"])
        .maybeSingle();
      if ((contract as any)?.id) {
        contractId = (contract as any).id;
      } else {
        const { data: c, error: cErr } = await admin
          .from("contracts")
          .insert({
            customer_id: customerId,
            plan_id: (basePlan as any)?.id ?? null,
            status: "active",
            current_period_end: new Date(
              Date.now() + 30 * 24 * 3600 * 1000,
            ).toISOString(),
          })
          .select("id")
          .single();
        if (cErr || !c) {
          errors.push(`[contract] ${customerId}: ${cErr?.message ?? "作成失敗"}`);
          continue;
        }
        contractId = c.id;
      }

      // Consolidate on (customer, horse)
      const { data: existingRow } = await admin
        .from("support_subscriptions")
        .select("id")
        .eq("customer_id", customerId)
        .eq("horse_id", horseId)
        .in("status", ["active", "past_due"])
        .maybeSingle();
      if (existingRow) {
        const { error } = await admin
          .from("support_subscriptions")
          .update({ units, monthly_amount: monthly, status })
          .eq("id", (existingRow as any).id);
        if (error) errors.push(`[merge] ${error.message}`);
        else updated += 1;
        continue;
      }

      const { error: iErr } = await admin.from("support_subscriptions").insert({
        contract_id: contractId,
        customer_id: customerId,
        horse_id: horseId,
        units,
        monthly_amount: monthly,
        status,
      });
      if (iErr) errors.push(`[create] ${iErr.message}`);
      else created += 1;
    } catch (e: any) {
      errors.push(`[error] ${e?.message ?? "unknown"}`);
    }
  }

  return NextResponse.json({ ok: true, created, updated, errors });
}
