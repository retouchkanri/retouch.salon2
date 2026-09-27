import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const patchSchema = z.object({
  team_name: z.string().max(120).nullable(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("supports.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });

  const team_name = parsed.data.team_name?.trim() || null;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("special_team_memberships")
    .update({ team_name })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "special_team.update",
    target_table: "special_team_memberships",
    target_id: params.id,
    meta: { team_name },
  });
  return NextResponse.json({ ok: true });
}

// 特別チーム会員の停止（記録上の停止）。Stripe連携は行わない手動登録分が対象のため、
// status=canceled に落とすのみ。外部Stripeの解約は別途Stripe管理画面で行う運用。
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("supports.manage");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("special_team_memberships")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "special_team.cancel",
    target_table: "special_team_memberships",
    target_id: params.id,
  });
  return NextResponse.json({ ok: true });
}
