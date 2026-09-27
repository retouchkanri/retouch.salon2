import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

// 無料会員（プラン未加入）の一括削除。安全のため、送信された ID の中から
// 実際に「空白（無料）会員」（member_class_code なし かつ リタポなし かつ
// 特別チームなし。会員一覧の cls=NONE と同一条件）に該当するものだけを
// サーバー側で再判定して削除する。画面表示が古い場合でも有料会員が誤って
// 削除されないようにするため。
export async function POST(req: Request) {
  const session = await requireCapability("customers.manage");
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });

  const admin = createSupabaseAdminClient();

  const { data: summaries, error: sumErr } = await admin
    .from("v_customer_summary")
    .select("customer_id, full_name, email, member_class_code, rpt_active, special_team_count")
    .in("customer_id", parsed.data.ids);
  if (sumErr) return NextResponse.json({ error: sumErr.message }, { status: 500 });

  const eligible = ((summaries as any[]) ?? []).filter(
    (s) => s.member_class_code == null && s.rpt_active === false && (s.special_team_count ?? 0) === 0
  );
  const eligibleIds = eligible.map((s) => s.customer_id as string);
  const skipped = parsed.data.ids.length - eligibleIds.length;

  if (eligibleIds.length === 0) {
    return NextResponse.json({ deleted: 0, skipped });
  }

  const { error } = await admin.from("customers").delete().in("id", eligibleIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert(
    eligible.map((s) => ({
      actor_id: session.userId,
      action: "customer.bulk_delete",
      target_table: "customers",
      target_id: s.customer_id,
      meta: { full_name: s.full_name ?? null, email: s.email ?? null },
    }))
  );

  return NextResponse.json({ deleted: eligibleIds.length, skipped });
}
