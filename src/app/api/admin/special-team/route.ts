import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// 管理画面からの「特別チーム（ガンガン）会員」手動登録。
// 既にStripe等の外部で課金中の会員を、システム上の記録として登録するための導線。
// 新たなStripe課金は一切行わず（stripe_* は null のまま）、status=active で登録する。
const schema = z.object({
  customer_id: z.string().uuid(),
  horse_id: z.string().uuid(),
  team_name: z.string().max(120).optional().nullable(),
  monthly_amount: z.coerce.number().int().positive().optional(),
});

export async function POST(req: Request) {
  const session = await requireCapability("supports.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const { customer_id, horse_id } = parsed.data;
  const team_name = parsed.data.team_name?.trim() || null;
  const admin = createSupabaseAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("id", customer_id)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "顧客が見つかりません" }, { status: 404 });
  }

  const { data: horse } = await admin
    .from("horses")
    .select("id")
    .eq("id", horse_id)
    .maybeSingle();
  if (!horse) return NextResponse.json({ error: "馬が見つかりません" }, { status: 404 });

  // 既定額は SPECIAL_TEAM プランの金額（¥1,000）。指定があればそれを優先。
  let monthly = parsed.data.monthly_amount;
  if (!monthly) {
    const { data: plan } = await admin
      .from("membership_plans")
      .select("monthly_amount")
      .eq("code", "SPECIAL_TEAM")
      .eq("is_active", true)
      .order("sort_order")
      .limit(1)
      .maybeSingle();
    monthly = (plan?.monthly_amount as number | undefined) ?? 1000;
  }

  // 1馬につき1契約のみ（重複防止）。
  const { data: existing } = await admin
    .from("special_team_memberships")
    .select("id")
    .eq("customer_id", customer_id)
    .eq("horse_id", horse_id)
    .in("status", ["active", "past_due", "incomplete"])
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "この馬の特別チーム会員はすでに登録されています。" },
      { status: 409 },
    );
  }

  const { data: inserted, error: insErr } = await admin
    .from("special_team_memberships")
    .insert({
      customer_id,
      horse_id,
      monthly_amount: monthly,
      team_name,
      status: "active",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json({ error: insErr?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "special_team.create.manual",
    target_table: "special_team_memberships",
    target_id: inserted.id,
    meta: { customer_id, horse_id, team_name, monthly, source: "admin_manual" },
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}
