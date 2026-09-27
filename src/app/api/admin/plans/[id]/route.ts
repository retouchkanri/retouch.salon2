import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const patchSchema = z.object({
  code: z.enum(["A", "B", "C", "SPECIAL_TEAM", "SUPPORT", "RPT"]).optional(),
  name: z.string().min(1).max(120).optional(),
  monthly_amount: z.number().int().min(0).optional(),
  unit_amount: z.number().int().min(0).optional().nullable(),
  stripe_price_id: z.string().optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  allow_with_support: z.boolean().optional(),
  allow_with_team: z.boolean().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("plans.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("membership_plans").update(parsed.data).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "plan.update",
    target_table: "membership_plans",
    target_id: params.id,
    meta: parsed.data,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("plans.manage");
  const admin = createSupabaseAdminClient();
  // If any contract references this plan, soft-disable instead of hard-delete.
  const { count } = await admin
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", params.id);
  if ((count ?? 0) > 0) {
    const { error } = await admin
      .from("membership_plans")
      .update({ is_active: false })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "plan.disable",
      target_table: "membership_plans",
      target_id: params.id,
    });
    return NextResponse.json({ ok: true, soft: true });
  }
  const { error } = await admin.from("membership_plans").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "plan.delete",
    target_table: "membership_plans",
    target_id: params.id,
  });
  return NextResponse.json({ ok: true });
}
