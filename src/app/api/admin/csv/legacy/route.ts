import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseCsv } from "@/lib/csv";
import { writeAudit } from "@/lib/audit";
import {
  groupByCustomer,
  parseLegacyTable,
  type LegacyCustomer,
} from "@/lib/legacy-import";

/**
 * POST /api/admin/csv/legacy
 *
 * Accepts the legacy management-spreadsheet CSV (Japanese column names,
 * one row per supported horse) and migrates it into customers / contracts /
 * support_subscriptions.
 *
 *   - multipart field `file`: the CSV (UTF-8, BOM tolerated)
 *   - multipart field `dry_run` = "1" to preview without writing.
 *
 * The endpoint is idempotent — re-running on the same CSV updates existing
 * rows in place rather than producing duplicates.
 */
export async function POST(req: Request) {
  const session = await requireCapability("csv");
  const fd = await req.formData();
  const file = fd.get("file");
  const dryRun = String(fd.get("dry_run") ?? "") === "1";

  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "CSVファイルを添付してください" },
      { status: 400 },
    );
  }

  const text = new TextDecoder("utf-8")
    .decode(await (file as File).arrayBuffer())
    .replace(/^﻿/, "");
  const table = parseCsv(text);
  const { rows, headerWarnings } = parseLegacyTable(table);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "データ行が見つかりません", headerWarnings },
      { status: 400 },
    );
  }

  const { customers, dropped } = groupByCustomer(rows);
  if (customers.length === 0) {
    return NextResponse.json(
      {
        error: "有効な顧客行が見つかりませんでした",
        headerWarnings,
        dropped: dropped.slice(0, 20).map(formatDropped),
      },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Pre-load plans + horses so the inner loop avoids N+1 lookups.
  const { data: planRows } = await admin
    .from("membership_plans")
    .select("id, code, name, unit_amount, monthly_amount");
  const plans = new Map<string, { id: string; unit_amount: number | null; monthly_amount: number }>();
  for (const p of planRows ?? []) {
    plans.set(`${p.code}:${p.name}`, {
      id: p.id as string,
      unit_amount: (p.unit_amount as number | null) ?? null,
      monthly_amount: p.monthly_amount as number,
    });
  }
  const supportFullPlan = plans.get("SUPPORT:1口支援") ?? null;
  const supportHalfPlan = plans.get("SUPPORT:半口支援") ?? null;

  const horseNames = Array.from(
    new Set(
      customers.flatMap((c) => c.supports.map((s) => s.horseName)),
    ),
  );
  const horseIdByName = new Map<string, string>();
  if (horseNames.length > 0) {
    const { data: horseRows } = await admin
      .from("horses")
      .select("id, name")
      .in("name", horseNames);
    for (const h of horseRows ?? []) {
      horseIdByName.set(h.name as string, h.id as string);
    }
  }

  const summary = {
    customersCreated: 0,
    customersUpdated: 0,
    contractsCreated: 0,
    supportsCreated: 0,
    supportsUpdated: 0,
    horsesCreated: 0,
    errors: [] as string[],
    warnings: [...headerWarnings, ...dropped.map(formatDropped)],
    preview: [] as PreviewLine[],
  };

  // Ensure horses (commit phase only — dry-run reports the missing ones).
  const missingHorses = horseNames.filter((n) => !horseIdByName.has(n));
  if (missingHorses.length > 0 && !dryRun) {
    const payload = missingHorses.map((name, i) => ({
      name,
      name_kana: name,
      is_supportable: true,
      sort_order: 1000 + i,
      profile: "既存CSV移行から自動登録",
    }));
    const { data: inserted, error: hErr } = await admin
      .from("horses")
      .insert(payload)
      .select("id, name");
    if (hErr) {
      return NextResponse.json(
        { error: `馬マスタの作成に失敗: ${hErr.message}` },
        { status: 500 },
      );
    }
    for (const h of inserted ?? []) {
      horseIdByName.set(h.name as string, h.id as string);
      summary.horsesCreated += 1;
    }
  } else if (missingHorses.length > 0) {
    for (const name of missingHorses) {
      summary.warnings.push(`馬マスタに未登録: ${name}（取込時に新規作成）`);
    }
  }

  for (const customer of customers) {
    try {
      const line = await migrateCustomer(customer, {
        admin,
        plans,
        supportFullPlan,
        supportHalfPlan,
        horseIdByName,
        dryRun,
      });
      summary.preview.push(line);
      if (line.customer === "create") summary.customersCreated += 1;
      if (line.customer === "update") summary.customersUpdated += 1;
      if (line.contract === "create") summary.contractsCreated += 1;
      summary.supportsCreated += line.supportsCreated;
      summary.supportsUpdated += line.supportsUpdated;
    } catch (e: any) {
      summary.errors.push(
        `[${customer.email}] ${e?.message ?? "unknown error"}`,
      );
    }
  }

  if (!dryRun) {
    await writeAudit({
      actorId: session.userId,
      action: "customer.legacy_import",
      meta: {
        rows: rows.length,
        customers: customers.length,
        created: summary.customersCreated,
        updated: summary.customersUpdated,
        contractsCreated: summary.contractsCreated,
        supportsCreated: summary.supportsCreated,
        supportsUpdated: summary.supportsUpdated,
        errors: summary.errors.length,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    totals: {
      sourceRows: rows.length,
      uniqueCustomers: customers.length,
      droppedRows: dropped.length,
    },
    created: summary.customersCreated,
    updated: summary.customersUpdated,
    contractsCreated: summary.contractsCreated,
    supportsCreated: summary.supportsCreated,
    supportsUpdated: summary.supportsUpdated,
    horsesCreated: summary.horsesCreated,
    errors: summary.errors,
    warnings: summary.warnings,
    // Cap preview so the JSON stays small on big files.
    preview: summary.preview.slice(0, 100),
  });
}

type PreviewLine = {
  email: string;
  fullName: string;
  customer: "create" | "update" | "skip";
  contract: "create" | "reuse" | "none";
  supportsCreated: number;
  supportsUpdated: number;
  notes: string[];
};

type Ctx = {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  plans: Map<string, { id: string; unit_amount: number | null; monthly_amount: number }>;
  supportFullPlan: { id: string; unit_amount: number | null; monthly_amount: number } | null;
  supportHalfPlan: { id: string; unit_amount: number | null; monthly_amount: number } | null;
  horseIdByName: Map<string, string>;
  dryRun: boolean;
};

async function migrateCustomer(
  customer: LegacyCustomer,
  ctx: Ctx,
): Promise<PreviewLine> {
  const { admin, plans, supportFullPlan, supportHalfPlan, horseIdByName, dryRun } = ctx;
  const notes: string[] = [];

  const payload = {
    email: customer.email,
    full_name: customer.fullName,
    full_name_kana: customer.fullNameKana,
    phone: customer.phone,
    postal_code: customer.postalCode,
    address1: customer.address,
    status: customer.status,
    stripe_customer_id: customer.stripeCustomerId,
  };

  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("email", customer.email)
    .maybeSingle();

  let customerId: string | null = (existing as any)?.id ?? null;
  let customerOp: PreviewLine["customer"] = customerId ? "update" : "create";

  if (!dryRun) {
    if (customerId) {
      const { error } = await admin
        .from("customers")
        .update(payload)
        .eq("id", customerId);
      if (error) throw new Error(`customer update: ${error.message}`);
    } else {
      const { data: created, error } = await admin
        .from("customers")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw new Error(`customer insert: ${error.message}`);
      customerId = (created as any).id as string;
    }
  }

  // ---- contract ----
  let contractId: string | null = null;
  let contractOp: PreviewLine["contract"] = "none";

  const planEntry = customer.plan
    ? plans.get(`${customer.plan.code}:${customer.plan.name}`) ?? null
    : null;
  const needsContract = !!planEntry || customer.supports.length > 0;

  if (needsContract && customerId) {
    const { data: existingContract } = await admin
      .from("contracts")
      .select("id")
      .eq("customer_id", customerId)
      .in("status", ["active", "past_due"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((existingContract as any)?.id) {
      contractId = (existingContract as any).id as string;
      contractOp = "reuse";
    } else if (!dryRun) {
      const fallbackPlan = planEntry ?? supportFullPlan ?? supportHalfPlan;
      const { data: ctr, error } = await admin
        .from("contracts")
        .insert({
          customer_id: customerId,
          plan_id: fallbackPlan?.id ?? null,
          status: "active",
          started_at: customer.contractStartedAt
            ? `${customer.contractStartedAt}T00:00:00Z`
            : new Date().toISOString(),
          current_period_end: new Date(
            Date.now() + 30 * 24 * 3600 * 1000,
          ).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(`contract insert: ${error.message}`);
      contractId = (ctr as any).id as string;
      contractOp = "create";
    } else {
      contractOp = "create";
    }
  }

  // ---- support subscriptions ----
  let supportsCreated = 0;
  let supportsUpdated = 0;

  for (const s of customer.supports) {
    const horseId = horseIdByName.get(s.horseName);
    if (!horseId) {
      // In dry-run the horse will be auto-created on commit; record as create.
      notes.push(`[行${s.rowNumber}] 馬「${s.horseName}」を新規作成予定`);
      if (!dryRun) continue; // safety — shouldn't happen because we auto-created above
      supportsCreated += 1;
      continue;
    }
    // Per-口 price is always 12,000円. A half share is units=0.5, so it
    // correctly resolves to 12000*0.5 = 6,000円. (Using the 半口支援 plan's
    // own unit_amount of 6,000 here would double-apply the "half" → 3,000円.)
    const perUnit = supportFullPlan?.unit_amount ?? 12000;
    const monthly = Math.round(perUnit * s.units);

    if (!customerId) {
      // dry-run with new customer — record as create
      supportsCreated += 1;
      continue;
    }

    const { data: existingSupport } = await admin
      .from("support_subscriptions")
      .select("id")
      .eq("customer_id", customerId)
      .eq("horse_id", horseId)
      .in("status", ["active", "past_due"])
      .maybeSingle();

    if ((existingSupport as any)?.id) {
      if (!dryRun) {
        const { error } = await admin
          .from("support_subscriptions")
          .update({ units: s.units, monthly_amount: monthly })
          .eq("id", (existingSupport as any).id);
        if (error) {
          notes.push(`[行${s.rowNumber}] update失敗: ${error.message}`);
          continue;
        }
      }
      supportsUpdated += 1;
    } else {
      if (!dryRun) {
        if (!contractId) {
          notes.push(`[行${s.rowNumber}] 契約未生成のため支援を作成できません`);
          continue;
        }
        const { error } = await admin.from("support_subscriptions").insert({
          contract_id: contractId,
          customer_id: customerId,
          horse_id: horseId,
          units: s.units,
          monthly_amount: monthly,
          status: "active",
          started_at: s.contractDate
            ? `${s.contractDate}T00:00:00Z`
            : new Date().toISOString(),
        });
        if (error) {
          notes.push(`[行${s.rowNumber}] insert失敗: ${error.message}`);
          continue;
        }
      }
      supportsCreated += 1;
    }
  }

  return {
    email: customer.email,
    fullName: customer.fullName,
    customer: customerOp,
    contract: contractOp,
    supportsCreated,
    supportsUpdated,
    notes,
  };
}

function formatDropped(d: {
  row: { rowNumber: number; fullName: string | null };
  reason: string;
}): string {
  return `[行${d.row.rowNumber}] ${d.reason}${
    d.row.fullName ? ` (氏名: ${d.row.fullName})` : ""
  }`;
}
