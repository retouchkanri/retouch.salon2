import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncSupportCancel } from "@/lib/stripeSupport";
import { notify, staffRecipients, supportCanceledTemplate } from "@/lib/notify";

/**
 * 支援停止API。
 *
 * デフォルトは「次回更新日で停止」（cancel_at_period_end）。
 * DB は `status='active'` のまま、`canceled_at` に予定終了日(ISO)を
 * 書き込み、UIで「停止予定」表示する。実際の `canceled` への遷移は
 * Stripe Webhook（customer.subscription.deleted）で行う。
 *
 * 即時停止が必要な場合は、管理画面から別途対応する。
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("support_subscriptions")
    .select(
      "id, customer_id, units, monthly_amount, stripe_subscription_item_id, contract:contracts(id, stripe_subscription_id, current_period_end), horse:horses(name)",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!existing || (existing as any).customer_id !== session.customerId) {
    return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 });
  }

  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  let sync;
  let syncError: string | null = null;
  try {
    sync = await syncSupportCancel({
      stripe_subscription_item_id: (existing as any).stripe_subscription_item_id ?? null,
      stripe_subscription_id: (existing as any).contract?.stripe_subscription_id ?? null,
      immediate: false,
    });
  } catch (e: any) {
    sync = { synced: false, reason: e?.message ?? "stripe_error" };
    syncError = e?.message ?? "Stripeとの同期に失敗しました";
  }

  // A row that was never Stripe-billed (registered by staff and invoiced
  // manually) has nothing to cancel — that is a successful stop, not a sync
  // failure. Previously it returned 502 and the member could never stop it.
  const nothingToCancel = sync?.reason === "item_missing" || sync?.reason === "not_billed_by_stripe";

  if (stripeEnabled && !sync?.synced && !nothingToCancel) {
    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "support.cancel.sync_failed",
      target_table: "support_subscriptions",
      target_id: params.id,
      meta: {
        horse_name: (existing as any).horse?.name ?? null,
        stripe: sync,
      },
    });
    return NextResponse.json(
      {
        error:
          syncError ??
          "決済の同期に失敗したため、停止の手続きを完了できませんでした。時間をおいて再度お試しください。",
      },
      { status: 502 },
    );
  }

  // Branch on what Stripe ACTUALLY did, never on whether a date came back.
  // The old `sync.scheduled_cancel_at ?? contract.current_period_end` turned an
  // immediate item deletion (what Stripe does when other items remain on the
  // subscription) into a "stops at period end" result: the row stayed `active`
  // still holding the id of an item Stripe had already deleted. A later re-signup
  // then found that zombie row and ADDED 口数 to it, doubling the quantity — the
  // 2026-09 over-charge. Only `mode: "scheduled"` may keep the row active.
  const scheduledAt =
    (sync as any)?.mode === "scheduled"
      ? ((sync as any)?.scheduled_cancel_at ??
        (existing as any).contract?.current_period_end ??
        null)
      : null;

  if (scheduledAt) {
    // 次回更新日で停止 → status は active のまま、停止予定日を canceled_at に保存
    const { error } = await admin
      .from("support_subscriptions")
      .update({ canceled_at: scheduledAt })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "support.cancel.scheduled",
      target_table: "support_subscriptions",
      target_id: params.id,
      meta: {
        horse_name: (existing as any).horse?.name ?? null,
        units: Number((existing as any).units),
        monthly: Number((existing as any).monthly_amount),
        scheduled_cancel_at: scheduledAt,
        stripe: sync,
      },
    });

    const { data: cust } = await admin
      .from("customers")
      .select("full_name, email")
      .eq("id", session.customerId)
      .maybeSingle();
    const tpl = supportCanceledTemplate({
      name: (cust as any)?.full_name ?? null,
      horseName: (existing as any).horse?.name ?? "ご支援馬",
      scheduledAt,
    });
    await notify({
      kind: "support_canceled",
      to: (cust as any)?.email ?? session.email,
      to_name: (cust as any)?.full_name ?? null,
      subject: tpl.subject,
      body_text: tpl.body_text,
      meta: { support_id: params.id, scheduled_cancel_at: scheduledAt },
    });

    // スタッフへの支援停止通知（スケジュール）
    {
      const custName = (cust as any)?.full_name ?? "（不明）";
      const custEmail = (cust as any)?.email ?? session.email;
      const horseName = (existing as any).horse?.name ?? "（不明）";
      const d = new Date(scheduledAt);
      const whenStr = Number.isNaN(d.getTime())
        ? scheduledAt
        : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      await notify({
        kind: "staff_notify",
        to: staffRecipients(),
        subject: `【一口支援 停止申込】${custName} — ${horseName}`,
        body_text:
          `一口支援の停止申込がありました。\n\n` +
          `・会員名: ${custName}\n` +
          `・メール: ${custEmail}\n` +
          `・対象馬: ${horseName}\n` +
          `・停止予定日: ${whenStr}`,
        reply_to: custEmail,
        meta: { support_id: params.id, scheduled_cancel_at: scheduledAt, source: "support_cancel_scheduled" },
      });
    }

    return NextResponse.json({
      ok: true,
      scheduled_cancel_at: scheduledAt,
      stripe: sync,
    });
  }

  // 予定日が取れない or 即時削除系（複数アイテム中の1件 / 開発環境）
  const { error } = await admin
    .from("support_subscriptions")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      stripe_subscription_item_id: null,
    })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "support.cancel",
    target_table: "support_subscriptions",
    target_id: params.id,
    meta: {
      horse_name: (existing as any).horse?.name ?? null,
      units: Number((existing as any).units),
      monthly: Number((existing as any).monthly_amount),
      stripe: sync,
    },
  });

  const { data: cust } = await admin
    .from("customers")
    .select("full_name, email")
    .eq("id", session.customerId)
    .maybeSingle();
  const tplImmediate = supportCanceledTemplate({
    name: (cust as any)?.full_name ?? null,
    horseName: (existing as any).horse?.name ?? "ご支援馬",
    scheduledAt: null,
  });
  await notify({
    kind: "support_canceled",
    to: (cust as any)?.email ?? session.email,
    to_name: (cust as any)?.full_name ?? null,
    subject: tplImmediate.subject,
    body_text: tplImmediate.body_text,
    meta: { support_id: params.id, immediate: true },
  });

  // スタッフへの支援停止通知（即時）
  {
    const custName = (cust as any)?.full_name ?? "（不明）";
    const custEmail = (cust as any)?.email ?? session.email;
    const horseName = (existing as any).horse?.name ?? "（不明）";
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【一口支援 停止申込】${custName} — ${horseName}`,
      body_text:
        `一口支援の停止申込がありました。\n\n` +
        `・会員名: ${custName}\n` +
        `・メール: ${custEmail}\n` +
        `・対象馬: ${horseName}\n` +
        `・停止区分: 即時停止`,
      reply_to: custEmail,
      meta: { support_id: params.id, immediate: true, source: "support_cancel_immediate" },
    });
  }

  return NextResponse.json({ ok: true, stripe: sync });
}
