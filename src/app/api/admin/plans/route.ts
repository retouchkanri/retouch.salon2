import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  code: z.enum(["A", "B", "C", "SPECIAL_TEAM", "SUPPORT", "RPT"]),
  name: z.string().min(1).max(120),
  monthly_amount: z.number().int().min(0),
  unit_amount: z.number().int().min(0).optional().nullable(),
  stripe_price_id: z.string().optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  allow_with_support: z.boolean().optional(),
  allow_with_team: z.boolean().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export async function POST(req: Request) {
  const session = await requireCapability("plans.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("membership_plans")
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      monthly_amount: parsed.data.monthly_amount,
      unit_amount: parsed.data.unit_amount ?? null,
      stripe_price_id: parsed.data.stripe_price_id || null,
      description: parsed.data.description || null,
      allow_with_support: parsed.data.allow_with_support ?? false,
      allow_with_team: parsed.data.allow_with_team ?? true,
      is_active: parsed.data.is_active ?? true,
      sort_order: parsed.data.sort_order ?? 100,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "plan.create",
    target_table: "membership_plans",
    target_id: data.id,
    meta: parsed.data,
  });
  return NextResponse.json({ ok: true, id: data.id });
}
