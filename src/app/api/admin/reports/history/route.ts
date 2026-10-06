import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { SYSTEM_START_YM, countHistoryTable, currentYearMonth } from "@/lib/monthlyReport";
import { loadCountHistory } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * 経営管理の「会員種別と一口支援の推移」の過去分。集計を始めた月から今月までを、1 か月 1 行の CSV で出す。
 * 入っているのは月ごとの人数と口数だけで、会員の名前などは含まない。
 */
export async function GET() {
  await requireCapability("payments.manage");
  const { history, error } = await loadCountHistory(createSupabaseAdminClient());
  if (error) return NextResponse.json({ error: "集計に必要なデータを読み込めませんでした。" }, { status: 500 });

  const ym = currentYearMonth();
  const table = countHistoryTable(history, ym);
  // 先頭の BOM は、Excel で開いたときに日本語が文字化けしないようにするため。
  return new NextResponse("﻿" + toCsv(table.rows, table.columns), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="member_trend_${SYSTEM_START_YM}_to_${ym}.csv"`,
      "cache-control": "no-store",
    },
  });
}
