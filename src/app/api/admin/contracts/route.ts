import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  customer_id: z.string().uuid(),
  plan_id: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "past_due", "canceled", "paused", "incomplete"]).default("active"),
  current_period_end: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const session = await requireCapability("contracts.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("contracts")
    .insert({
      customer_id: parsed.data.customer_id,
      plan_id: parsed.data.plan_id ?? null,
      status: parsed.data.status,
      current_period_end: parsed.data.current_period_end ?? null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "contract.create",
    target_table: "contracts",
    target_id: data.id,
    meta: parsed.data,
  });
  return NextResponse.json({ ok: true, id: data.id });
}
