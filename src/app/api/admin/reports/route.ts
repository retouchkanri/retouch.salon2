import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { LEGACY_END_YM, buildLegacySummary, isLegacyMonth } from "@/lib/legacyReport";
import { EXPENSE_FIELDS, buildMonthReport, parseAdjustments, parseYearMonth } from "@/lib/monthlyReport";
import { loadReportInputs } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  ym: z.string().regex(/^\d{4}-\d{2}$/),
  expenses: z.record(z.string(), z.coerce.number()).default({}),
  horseCount: z.number().int().min(0).nullable().optional(),
  // 公開する数字に入れる手入力の調整。中身は parseAdjustments で整える。
  adjust: z.record(z.string(), z.union([z.number(), z.null()])).default({}),
  note: z.string().max(4000).optional().default(""),
  publish: z.boolean().default(false),
});

function saveFailed(error: { code?: string; message?: string }) {
  const missing = error.code === "42P01" || error.code === "PGRST205" || /monthly_reports/.test(error.message ?? "");
  return NextResponse.json(
    { error: missing ? "月次報告のテーブルがまだありません。SQLを適用してから保存してください。" : "保存に失敗しました。" },
    { status: missing ? 409 : 500 },
  );
}

export async function POST(req: Request) {
  const session = await requireCapability("payments.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || !parseYearMonth(parsed.data?.ym ?? "")) {
    return NextResponse.json({ error: "年月の指定を確認してください。" }, { status: 400 });
  }
  const { ym, note, publish } = parsed.data!;
  const admin = createSupabaseAdminClient();

  // システム開始前は、公開済みの収支をまとめた 1 件だけを LEGACY_END_YM の行に持つ。会員サイトの集計は使わない。
  if (isLegacyMonth(ym)) {
    if (ym !== LEGACY_END_YM) {
      return NextResponse.json({ error: "システム開始前の月は、開始前のまとめとして公開します。" }, { status: 400 });
    }
    const row: Record<string, unknown> = {
      year_month: ym,
      note,
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    };
    if (publish) {
      row.published_at = new Date().toISOString();
      row.snapshot = { legacy: buildLegacySummary(), note };
    }
    const { error } = await admin.from("monthly_reports").upsert(row, { onConflict: "year_month" });
    return error ? saveFailed(error) : NextResponse.json({ ok: true });
  }

  const expenses = Object.fromEntries(EXPENSE_FIELDS.map((field) => {
    const value = Number(parsed.data!.expenses[field.key]);
    return [field.key, Number.isFinite(value) && value > 0 ? Math.round(value) : 0];
  }));
  const horseCount = parsed.data!.horseCount == null || Number.isNaN(Number(parsed.data!.horseCount))
    ? null
    : Math.max(0, Math.round(Number(parsed.data!.horseCount)));

  const adjust = parseAdjustments(parsed.data!.adjust);

  // 画面に出している数字と同じ材料で作る。
  const { source, error: sourceError, adjustByMonth, liveSupport } = await loadReportInputs(admin, ym);
  if (sourceError) {
    return NextResponse.json({ error: "集計に必要なデータを読み込めませんでした。" }, { status: 500 });
  }
  const report = buildMonthReport({ ...source, liveSupport }, ym, horseCount, { adjust, adjustByMonth });
  if (!report) {
    return NextResponse.json({ error: "年月の指定を確認してください。" }, { status: 400 });
  }

  const row: Record<string, unknown> = {
    year_month: ym,
    // 手入力の調整は、経費の内訳と同じ列（その月に管理者が入れた数字）に入れる。
    expenses: { ...expenses, adjust },
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

  return error ? saveFailed(error) : NextResponse.json({ ok: true });
}
