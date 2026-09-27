import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncSpecialTeamCancel } from "@/lib/stripeSpecialTeam";
import { notify } from "@/lib/notify";

/**
 * 特別チーム会員 停止API。
 * デフォルトは「次回更新日で停止」（cancel_at_period_end）。
 * 停止予定日が取れる場合は status=active のまま canceled_at に予定日を保存。
 */
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("special_team_memberships")
    .select("id, customer_id, monthly_amount, stripe_subscription_id, stripe_subscription_item_id, horse:horses(name)")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing || (existing as any).customer_id !== session.customerId) {
    return NextResponse.json({ error: "対象が見つかりません" }, { status: 404 });
  }

  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
  const horseName = (existing as any).horse?.name ?? "対象馬";

  let sync;
  let syncError: string | null = null;
  try {
    sync = await syncSpecialTeamCancel({
      stripe_subscription_id: (existing as any).stripe_subscription_id ?? null,
      stripe_subscription_item_id: (existing as any).stripe_subscription_item_id ?? null,
      immediate: false,
    });
  } catch (e: any) {
    sync = { synced: false, reason: e?.message ?? "stripe_error" };
    syncError = e?.message ?? "Stripeとの同期に失敗しました";
  }

  if (stripeEnabled && !sync?.synced) {
    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "special_team.cancel.sync_failed",
      target_table: "special_team_memberships",
      target_id: params.id,
      meta: { horse_name: horseName, stripe: sync },
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

  const scheduledAt = (sync as any)?.scheduled_cancel_at ?? null;

  const sendMail = async (when: string | null) => {
    const { data: cust } = await admin
      .from("customers")
      .select("full_name, email")
      .eq("id", session.customerId)
      .maybeSingle();
    const whenLabel = when
      ? (() => {
          const d = new Date(when);
          return Number.isNaN(d.getTime())
            ? "次回更新日"
            : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
        })()
      : "受付時点";
    await notify({
      kind: "plan_changed",
      to: (cust as any)?.email ?? session.email,
      to_name: (cust as any)?.full_name ?? null,
      subject: `【Retouch Members】特別チーム会員 停止のお知らせ — ${horseName}`,
      body_text:
        `${(cust as any)?.full_name ?? "ご支援者"}様\n\n` +
        `${horseName}の特別チーム会員を停止いたしました（${whenLabel}）。\n` +
        `またのご参加を心よりお待ちしております。`,
      meta: { special_team_id: params.id, scheduled_cancel_at: when },
    });
  };

  if (scheduledAt) {
    const { error } = await admin
      .from("special_team_memberships")
      .update({ canceled_at: scheduledAt })
      .eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "special_team.cancel.scheduled",
      target_table: "special_team_memberships",
      target_id: params.id,
      meta: { horse_name: horseName, scheduled_cancel_at: scheduledAt, stripe: sync },
    });
    await sendMail(scheduledAt);
    return NextResponse.json({ ok: true, scheduled_cancel_at: scheduledAt, stripe: sync });
  }

  const { error } = await admin
    .from("special_team_memberships")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      stripe_subscription_item_id: null,
    })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "special_team.cancel",
    target_table: "special_team_memberships",
    target_id: params.id,
    meta: { horse_name: horseName, stripe: sync },
  });
  await sendMail(null);
  return NextResponse.json({ ok: true, stripe: sync });
}
