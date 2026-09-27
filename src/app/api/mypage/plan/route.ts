import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { memberPlanMutationGuard } from "@/lib/memberGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cancelBasicPlan, subscribeBasicPlan } from "@/lib/plan";
import { donationThanksTemplate, notify, planChangedTemplate, staffRecipients } from "@/lib/notify";

const schema = z.object({
  plan_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberPlanMutationGuard(session);
  if (forbidden) return forbidden;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "プランを指定してください" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const [{ data: plan }, { data: customer }] = await Promise.all([
    admin.from("membership_plans").select("*").eq("id", parsed.data.plan_id).maybeSingle(),
    admin
      .from("customers")
      .select("id, email, full_name, stripe_customer_id")
      .eq("id", session.customerId)
      .maybeSingle(),
  ]);
  if (!plan || !(plan as any).is_active) {
    return NextResponse.json({ error: "プランが見つかりません" }, { status: 404 });
  }
  if (!customer) {
    return NextResponse.json({ error: "会員情報が見つかりません" }, { status: 404 });
  }
  const code = (plan as any).code as string;
  if (!["A", "B", "C"].includes(code)) {
    return NextResponse.json(
      { error: "このAPIではA/B/C会員のみ扱えます" },
      { status: 400 },
    );
  }
  // ¥0 の枠（アテンダー会員・オーナーズ会員等）は管理画面からの手動付与専用。
  // 会員側からのセルフ加入（Stripe決済フロー）では扱わない。
  if (Number((plan as any).monthly_amount) <= 0) {
    return NextResponse.json(
      { error: "この会員種別は会員側から選択できません（管理者が付与します）" },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await subscribeBasicPlan({
      customer: customer as any,
      plan: {
        id: (plan as any).id,
        code: code as "A" | "B" | "C",
        name: (plan as any).name,
        monthly_amount: (plan as any).monthly_amount,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "プラン変更に失敗しました" }, { status: 400 });
  }

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "plan.subscribe",
    target_table: "contracts",
    target_id: result.contractId,
    meta: { plan_id: (plan as any).id, code, synced: result.synced, reason: result.reason ?? null },
  });

  const tpl = planChangedTemplate({
    name: (customer as any).full_name,
    planName: (plan as any).name,
    monthly: (plan as any).monthly_amount,
  });
  await notify({
    kind: "plan_changed",
    to: (customer as any).email,
    to_name: (customer as any).full_name,
    subject: tpl.subject,
    body_text: tpl.body_text,
    meta: { contract_id: result.contractId, plan_id: (plan as any).id },
  });

  // スタッフへの会員種別変更通知
  await notify({
    kind: "staff_notify",
    to: staffRecipients(),
    subject: `【会員種別変更】${(customer as any).full_name} — ${(plan as any).name}`,
    body_text:
      `会員種別の変更がありました。\n\n` +
      `・会員名: ${(customer as any).full_name}\n` +
      `・メール: ${(customer as any).email}\n` +
      `・変更後プラン: ${(plan as any).name}（月額 ¥${Math.round((plan as any).monthly_amount).toLocaleString("ja-JP")}）`,
    reply_to: (customer as any).email,
    meta: { contract_id: result.contractId, plan_id: (plan as any).id, source: "plan_subscribe" },
  });

  // Silence unused-import warning kept for future reuse.
  void donationThanksTemplate;

  return NextResponse.json({
    ok: true,
    contract_id: result.contractId,
    synced: result.synced,
    reason: result.reason ?? null,
    checkout_url: result.checkoutUrl ?? null,
    requires_payment: result.requiresPayment ?? false,
  });
}

export async function DELETE() {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberPlanMutationGuard(session);
  if (forbidden) return forbidden;
  try {
    const res = await cancelBasicPlan(session.customerId);
    const admin = createSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "plan.cancel",
      target_table: "contracts",
      meta: res,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "停止に失敗しました" }, { status: 500 });
  }
}
