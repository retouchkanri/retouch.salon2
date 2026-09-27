import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const patchSchema = z.object({
  status: z.enum(["succeeded", "failed", "pending", "refunded", "canceled"]).optional(),
  amount: z.number().int().optional(),
  failure_reason: z.string().max(500).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("payments.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("payments").update(parsed.data).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "payment.update",
    target_table: "payments",
    target_id: params.id,
    meta: parsed.data,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("payments.manage");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("payments").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "payment.delete",
    target_table: "payments",
    target_id: params.id,
  });
  return NextResponse.json({ ok: true });
}
