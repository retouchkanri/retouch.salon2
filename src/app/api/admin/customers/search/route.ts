import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isHiddenAccountEmail } from "@/lib/hiddenAccounts";

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") ?? 10)));
  if (q.length < 1) return NextResponse.json({ results: [] });

  const admin = createSupabaseAdminClient();
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const { data, error } = await admin
    .from("customers")
    .select("id, full_name, full_name_kana, email")
    .or(
      [`full_name.ilike.${like}`, `full_name_kana.ilike.${like}`, `email.ilike.${like}`].join(","),
    )
    .order("full_name")
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // 内部テスト用アカウントは候補に表示しない。
  const results = (data ?? []).filter((r: any) => !isHiddenAccountEmail(r.email));
  return NextResponse.json({ results });
}
