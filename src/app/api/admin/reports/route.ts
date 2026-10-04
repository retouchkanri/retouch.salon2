import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { EXPENSE_FIELDS, buildMonthReport, parseYearMonth } from "@/lib/monthlyReport";
import { loadReportSource } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  ym: z.string().regex(/^\d{4}-\d{2}$/),
  expenses: z.record(z.string(), z.coerce.number()).default({}),
  horseCount: z.number().int().min(0).nullable().optional(),
  note: z.string().max(4000).optional().default(""),
  publish: z.boolean().default(false),
});

export async function POST(req: Request) {
  const session = await requireCapability("payments.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || !parseYearMonth(parsed.data?.ym ?? "")) {
    return NextResponse.json({ error: "年月の指定を確認してください。" }, { status: 400 });
  }
  const { ym, note, publish } = parsed.data!;
  const expenses = Object.fromEntries(EXPENSE_FIELDS.map((field) => {
    const value = Number(parsed.data!.expenses[field.key]);
    return [field.key, Number.isFinite(value) && value > 0 ? Math.round(value) : 0];
  }));
  const horseCount = parsed.data!.horseCount == null || Number.isNaN(Number(parsed.data!.horseCount))
    ? null
    : Math.max(0, Math.round(Number(parsed.data!.horseCount)));

  const admin = createSupabaseAdminClient();
  const { source, error: sourceError } = await loadReportSource(admin);
  if (sourceError) {
    return NextResponse.json({ error: "集計に必要なデータを読み込めませんでした。" }, { status: 500 });
  }
  const report = buildMonthReport(source, ym, horseCount);
  if (!report) {
    return NextResponse.json({ error: "年月の指定を確認してください。" }, { status: 400 });
  }

  const row: Record<string, unknown> = {
    year_month: ym,
    expenses,
    horse_count: horseCount,
    note,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };
  if (publish) {
    row.published_at = new Date().toISOString();
    row.snapshot = { report, expenses, note };
  }
  const { error } = await admin.from("monthly_reports").upsert(row, { onConflict: "year_month" });

  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205" || /monthly_reports/.test(error.message ?? "");
    return NextResponse.json(
      { error: missing ? "月次報告のテーブルがまだありません。SQLを適用してから保存してください。" : "保存に失敗しました。" },
      { status: missing ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
