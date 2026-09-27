import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

const patchSchema = z.object({
  plan_id: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "past_due", "canceled", "paused", "incomplete"]).optional(),
  current_period_end: z.string().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("contracts.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "canceled") {
    update.canceled_at = new Date().toISOString();
  }
  const { error } = await admin.from("contracts").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "contract.update",
    target_table: "contracts",
    target_id: params.id,
    meta: parsed.data,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("contracts.manage");
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";
  const admin = createSupabaseAdminClient();

  const { data: row } = await admin
    .from("contracts")
    .select("id, stripe_subscription_id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "契約が見つかりません" }, { status: 404 });

  const stripe = getStripe();
  if (stripe && (row as any).stripe_subscription_id && (row as any).status !== "canceled") {
    try {
      await stripe.subscriptions.cancel((row as any).stripe_subscription_id, { prorate: true });
    } catch {
      // continue even if already canceled on Stripe side
    }
  }

  if (hard) {
    const { error } = await admin.from("contracts").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await admin
      .from("contracts")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: hard ? "contract.delete" : "contract.cancel",
    target_table: "contracts",
    target_id: params.id,
  });
  return NextResponse.json({ ok: true });
}
