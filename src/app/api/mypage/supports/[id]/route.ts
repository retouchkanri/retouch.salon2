import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncSupportUnitsById } from "@/lib/stripeSupport";
import { SUPPORT_UNIT_PRICE } from "@/lib/constraints";
import { notify, staffRecipients, supportChangedTemplate } from "@/lib/notify";

const schema = z.object({
  plan_id: z.string().uuid(),
  units: z
    .number()
    .positive()
    .max(100)
    .refine((v) => Number.isInteger(v * 2), "口数は0.5口刻みで指定してください"),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { plan_id, units } = parsed.data;

  const supabase = createSupabaseServerClient();
  const { data: plan } = await supabase.from("membership_plans").select("*").eq("id", plan_id).maybeSingle();
  if (!plan || plan.code !== "SUPPORT") {
    return NextResponse.json({ error: "支援プランが正しくありません" }, { status: 400 });
  }
  // Authoritative per-口 price (半口 = units 0.5 → ¥6,000).
  const monthly = Math.round(SUPPORT_UNIT_PRICE * Number(units));

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("support_subscriptions")
    .select(
      "id, customer_id, contract_id, horse_id, units, monthly_amount, stripe_subscription_item_id, horse:horses(name)",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!existing || (existing as any).customer_id !== session.customerId) {
    return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 });
  }
  const prevUnits = Number((existing as any).units);
  const prevMonthly = Number((existing as any).monthly_amount);
  const horseName = (existing as any).horse?.name ?? null;

  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  // `syncSupportUnitsById` is the single Stripe-side entry point for a 口数
  // change (see stripeSupport.ts). It updates the linked item when that item is
  // still billable and self-heals — mints a fresh item/subscription — when it
  // is not: a legacy row imported before Stripe billing was connected, or a row
  // whose item/subscription has since died. `allow_create: true` because a
  // member editing their own support is asking for it to be billed.
  let sync;
  let syncError: string | null = null;
  try {
    sync = await syncSupportUnitsById({
      support_id: params.id,
      monthly_amount: monthly,
      allow_create: true,
    });
    if (!sync.synced && sync.reason && sync.reason !== "stripe_disabled") {
      syncError = "決済の同期に失敗しました";
    }
  } catch (e: any) {
    sync = { synced: false, reason: e?.message ?? "stripe_error" };
    syncError = e?.message ?? "Stripeとの同期に失敗しました";
  }

  const requiresStripePayment = Boolean(stripeEnabled && (sync as any)?.requires_payment);
  const canCommit = (sync?.synced && !requiresStripePayment) || !stripeEnabled;

  if (requiresStripePayment) {
    // Stripe 側は既に新しい口数で請求（未払いの請求書）を作っている。DB の口数を
    // 旧値のまま返すと、支払い完了後に DB と Stripe の請求額が食い違うため、
    // 口数だけは先に揃える（status は同期処理が incomplete にしており、
    // 支払い完了時に Webhook が active へ戻す）。
    const { error: rpErr } = await admin
      .from("support_subscriptions")
      .update({ units, monthly_amount: monthly })
      .eq("id", params.id);
    if (rpErr) return NextResponse.json({ error: rpErr.message }, { status: 500 });

    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "support.update.requires_payment",
      target_table: "support_subscriptions",
      target_id: params.id,
      meta: {
        plan_id,
        horse_name: horseName,
        prev_units: prevUnits,
        prev_monthly: prevMonthly,
        units,
        monthly,
        stripe: sync,
      },
    });
    return NextResponse.json({
      ok: true,
      support_id: params.id,
      checkout_url: (sync as any)?.checkout_url ?? null,
      requires_payment: true,
      stripe: sync,
    });
  }

  if (!canCommit) {
    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "support.update.sync_failed",
      target_table: "support_subscriptions",
      target_id: params.id,
      meta: {
        plan_id,
        horse_name: horseName,
        prev_units: prevUnits,
        prev_monthly: prevMonthly,
        units,
        monthly,
        stripe: sync,
      },
    });
    return NextResponse.json(
      {
        error:
          syncError ??
          "決済の同期に失敗したため、変更を確定できませんでした。時間をおいて再度お試しください。",
      },
      { status: 502 },
    );
  }

  const { error } = await admin
    .from("support_subscriptions")
    .update({ units, monthly_amount: monthly })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "support.update",
    target_table: "support_subscriptions",
    target_id: params.id,
    meta: {
      plan_id,
      horse_name: horseName,
      prev_units: prevUnits,
      prev_monthly: prevMonthly,
      units,
      monthly,
      stripe: sync,
    },
  });

  const { data: cust } = await admin
    .from("customers")
    .select("full_name, email")
    .eq("id", session.customerId)
    .maybeSingle();
  const tpl = supportChangedTemplate({
    name: (cust as any)?.full_name ?? null,
    horseName: horseName ?? "ご支援馬",
    prevUnits,
    prevMonthly,
    newUnits: Number(units),
    newMonthly: monthly,
    effectiveFrom: (sync as any)?.effective_from ?? null,
  });
  await notify({
    kind: "support_changed",
    to: (cust as any)?.email ?? session.email,
    to_name: (cust as any)?.full_name ?? null,
    subject: tpl.subject,
    body_text: tpl.body_text,
    meta: { support_id: params.id, prev_units: prevUnits, new_units: units },
  });

  // スタッフへの支援変更通知
  {
    const fmt = (n: number) => (Number.isInteger(n) ? `${n}口` : `${n.toFixed(1)}口`);
    const custName = (cust as any)?.full_name ?? "（不明）";
    const custEmail = (cust as any)?.email ?? session.email;
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【一口支援 変更】${custName} — ${horseName ?? "（不明）"}`,
      body_text:
        `一口支援内容の変更がありました。\n\n` +
        `・会員名: ${custName}\n` +
        `・メール: ${custEmail}\n` +
        `・対象馬: ${horseName ?? "（不明）"}\n` +
        `・変更前: ${fmt(prevUnits)} / 月額 ¥${Math.round(prevMonthly).toLocaleString("ja-JP")}\n` +
        `・変更後: ${fmt(Number(units))} / 月額 ¥${Math.round(monthly).toLocaleString("ja-JP")}`,
      reply_to: custEmail,
      meta: { support_id: params.id, prev_units: prevUnits, new_units: units, source: "support_update" },
    });
  }

  return NextResponse.json({ ok: true, stripe: sync });
}
