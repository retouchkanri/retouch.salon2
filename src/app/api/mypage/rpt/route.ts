import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { ensureStripeCustomer } from "@/lib/stripeSupport";
import { notify, planChangedTemplate, staffRecipients } from "@/lib/notify";

export async function POST(req: Request) {
  void req;
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;

  const admin = createSupabaseAdminClient();

  const [{ data: plan }, { data: customer }] = await Promise.all([
    admin
      .from("membership_plans")
      .select("*")
      .eq("code", "RPT")
      .eq("is_active", true)
      .maybeSingle(),
    admin
      .from("customers")
      .select("id, email, full_name, stripe_customer_id")
      .eq("id", session.customerId)
      .maybeSingle(),
  ]);
  if (!plan) {
    return NextResponse.json({ error: "リタポプランが見つかりません" }, { status: 400 });
  }
  if (!customer) {
    return NextResponse.json({ error: "会員情報が見つかりません" }, { status: 404 });
  }

  // 重複加入チェック
  const { data: existing } = await admin
    .from("contracts")
    .select("id")
    .eq("customer_id", session.customerId)
    .eq("plan_id", (plan as any).id)
    .in("status", ["active", "past_due", "incomplete"])
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "すでにリタポ会員にご加入いただいています。" },
      { status: 409 },
    );
  }

  const monthly: number = (plan as any).monthly_amount;
  const stripe = getStripe();
  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  // Stripe price を取得 or 作成
  let priceId: string | null = (plan as any).stripe_price_id ?? null;
  if (!priceId && stripe) {
    const price = await stripe.prices.create({
      currency: "jpy",
      unit_amount: monthly,
      recurring: { interval: "month" },
      product_data: { name: `RetouchPony【リタポ】メンバー` },
    });
    await admin
      .from("membership_plans")
      .update({ stripe_price_id: price.id })
      .eq("id", (plan as any).id);
    priceId = price.id;
  }

  // DB に契約行を作成
  const { data: contractRow, error: cErr } = await admin
    .from("contracts")
    .insert({
      customer_id: session.customerId,
      plan_id: (plan as any).id,
      status: stripe && priceId ? "incomplete" : "active",
      current_period_end: stripe && priceId
        ? null
        : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (cErr || !contractRow) {
    return NextResponse.json({ error: cErr?.message ?? "契約の作成に失敗しました" }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "rpt.create",
    target_table: "contracts",
    target_id: contractRow.id,
    meta: { plan_id: (plan as any).id, monthly },
  });

  // Stripe なし → DB 登録のみで完了
  if (!stripe || !priceId) {
    await sendNotification(customer as any, monthly);
    return NextResponse.json({ ok: true, contract_id: contractRow.id, synced: false });
  }

  const stripeCustomerId = await ensureStripeCustomer(customer as any);
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "Stripe顧客の作成に失敗しました" }, { status: 500 });
  }

  let checkoutUrl: string | null = null;
  let requiresPayment = false;

  try {
    const sub = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: priceId, quantity: 1 }],
      collection_method: "charge_automatically",
      payment_behavior: "default_incomplete",
      proration_behavior: "create_prorations",
      metadata: { contract_id: contractRow.id, plan_code: "RPT" },
      expand: ["latest_invoice"],
    });

    await admin
      .from("contracts")
      .update({
        stripe_subscription_id: sub.id,
        status:
          sub.status === "active" ? "active" :
          sub.status === "past_due" ? "past_due" :
          sub.status === "canceled" ? "canceled" :
          sub.status === "paused" ? "paused" : "incomplete",
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      })
      .eq("id", contractRow.id);

    const invoice = typeof sub.latest_invoice === "string" ? null : sub.latest_invoice;
    checkoutUrl = invoice?.hosted_invoice_url ?? null;
    requiresPayment = ["incomplete", "past_due", "unpaid"].includes(sub.status);
  } catch (e: any) {
    // Stripe失敗時はDB行を削除して500を返す
    await admin.from("contracts").delete().eq("id", contractRow.id);
    return NextResponse.json(
      { error: e?.message ?? "Stripeとの同期に失敗しました" },
      { status: 502 },
    );
  }

  if (!requiresPayment) {
    await sendNotification(customer as any, monthly);
  }

  return NextResponse.json({
    ok: true,
    contract_id: contractRow.id,
    checkout_url: checkoutUrl,
    requires_payment: requiresPayment,
    synced: stripeEnabled,
  });
}

async function sendNotification(
  customer: { email: string | null; full_name: string | null },
  monthly: number,
) {
  const tpl = planChangedTemplate({
    name: customer.full_name,
    planName: "RetouchPony【リタポ】メンバー",
    monthly,
  });
  await notify({
    kind: "plan_changed",
    to: customer.email,
    to_name: customer.full_name,
    subject: tpl.subject,
    body_text: tpl.body_text,
    meta: { plan_code: "RPT" },
  });

  await notify({
    kind: "staff_notify",
    to: staffRecipients(),
    subject: `【リタポ会員 申込】${customer.full_name}`,
    body_text:
      `リタポ会員のお申し込みがありました。\n\n` +
      `・会員名: ${customer.full_name}\n` +
      `・メール: ${customer.email}\n` +
      `・月額: ¥${monthly.toLocaleString("ja-JP")}`,
    reply_to: customer.email ?? undefined,
    meta: { plan_code: "RPT", source: "rpt_create" },
  });
}
