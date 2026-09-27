import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SUPPORT_UNIT_PRICE } from "@/lib/constraints";
import { syncSupportCancelById, syncSupportUnitsById } from "@/lib/stripeSupport";

/**
 * 管理画面からの支援編集 API。
 *
 * ここは必ず Stripe と同期させること。
 * 以前は units / status を Supabase に書くだけで Stripe を一切呼んでいなかった
 * ため、運営が「1口 → 半口」に変更しても、あるいは「停止」しても、Stripe 側の
 * subscription item はそのまま残り、旧金額の請求が毎月続いていた
 * （2026-09報告: 半口に変更したのに1口分が請求され続け、さらに「登録は解除済み」
 * のはずのカード2枚から48,000円ずつ引き落とされた）。
 *
 * 口数変更・停止・削除はすべて stripeSupport.ts の
 * syncSupportUnitsById / syncSupportCancelById を経由する。
 */

const patchSchema = z.object({
  units: z.coerce.number().positive().max(99).optional(),
  horse_id: z.string().uuid().optional(),
  status: z.enum(["active", "past_due", "canceled", "paused", "incomplete"]).optional(),
});

/**
 * 「Stripe 側に請求が存在しないので同期しようが無かった」＝DB だけ更新して
 * 問題ないケース。この場合に 502 で止めると、運営が壊れた行を直せなくなる。
 *
 * 逆に stripe_error など「生きている請求の更新に失敗した可能性がある」理由は
 * ここに入れないこと。DB だけ書き換えると請求額と表示が食い違い、今回の
 * 事故（半口に変更したのに1口が請求され続ける）を再発させる。
 */
function isBenignSyncReason(reason: string | undefined): boolean {
  return (
    reason === "stripe_disabled" ||
    reason === "not_billed_by_stripe" ||
    reason === "item_missing" ||
    reason === "support_missing" ||
    // item / サブスクリプションが既に消えている＝請求は発生していない。
    reason === "item_dead"
  );
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("supports.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();

  const { data: current } = await admin
    .from("support_subscriptions")
    .select("id, units, monthly_amount, status, horse_id, stripe_subscription_item_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "支援が見つかりません" }, { status: 404 });

  const patch: Record<string, any> = {};
  if (parsed.data.horse_id !== undefined) {
    patch.horse_id = parsed.data.horse_id;
  }
  if (parsed.data.units !== undefined) {
    patch.units = parsed.data.units;
    // 単価は常に SUPPORT_UNIT_PRICE（1口=12,000円）を正とする（route.ts の POST と同じ理由）。
    patch.monthly_amount = Math.round(SUPPORT_UNIT_PRICE * parsed.data.units);
  }
  if (parsed.data.status !== undefined) {
    patch.status = parsed.data.status;
    if (parsed.data.status === "canceled") patch.canceled_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "変更項目がありません" }, { status: 400 });
  }

  // 対象馬の変更は課金額に影響しないため先に反映し、後続の Stripe metadata に
  // 新しい馬名が載るようにする。
  if (patch.horse_id !== undefined && patch.horse_id !== current.horse_id) {
    const { error: hErr } = await admin
      .from("support_subscriptions")
      .update({ horse_id: patch.horse_id })
      .eq("id", params.id);
    if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
  }

  // --- Stripe 同期（DB を書く前に実施し、失敗したら DB も変更しない） ---
  const willCancel = patch.status === "canceled" && current.status !== "canceled";
  const amountChanged =
    patch.monthly_amount !== undefined && patch.monthly_amount !== Number(current.monthly_amount);

  let stripeSync: any = null;
  let stripeWarning: string | null = null;
  try {
    if (willCancel) {
      // 運営による停止は誤登録の是正が主目的なので即時停止（日割り精算あり）。
      stripeSync = await syncSupportCancelById({ support_id: params.id, immediate: true });
    } else if (amountChanged) {
      // allow_create: false — 運営手動請求の行に、無断で自動課金を作らない。
      stripeSync = await syncSupportUnitsById({
        support_id: params.id,
        monthly_amount: patch.monthly_amount,
        allow_create: false,
      });
    }
  } catch (e: any) {
    stripeSync = { synced: false, reason: e?.message ?? "stripe_error" };
  }

  if (stripeSync && !stripeSync.synced) {
    if (!isBenignSyncReason(stripeSync.reason)) {
      await admin.from("audit_logs").insert({
        actor_id: session.userId,
        action: willCancel ? "support.cancel.sync_failed" : "support.update.sync_failed",
        target_table: "support_subscriptions",
        target_id: params.id,
        meta: { patch, stripe: stripeSync },
      });
      return NextResponse.json(
        {
          error:
            "Stripeとの同期に失敗したため変更を保存しませんでした。" +
            "DBだけを書き換えると請求額が実際とずれるため中止しています。" +
            `（理由: ${stripeSync.reason ?? "unknown"}）`,
        },
        { status: 502 },
      );
    }
    // Stripe課金の無い行（運営手動請求）。DB は更新するが自動連動しない旨を返す。
    stripeWarning =
      "この支援はStripeの自動課金に紐づいていないため、請求内容は自動では変わりません。必要に応じて手動でご対応ください。";
  }

  // 停止が Stripe 側で完了した場合は、死んだ item id を残さない。
  if (willCancel && stripeSync?.synced) {
    patch.stripe_subscription_item_id = null;
  }

  const { error } = await admin.from("support_subscriptions").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "support.update",
    target_table: "support_subscriptions",
    target_id: params.id,
    meta: {
      prev_units: current.units,
      prev_monthly: current.monthly_amount,
      units: patch.units ?? current.units,
      monthly: patch.monthly_amount ?? current.monthly_amount,
      horse_id: patch.horse_id,
      status: patch.status,
      stripe: stripeSync,
    },
  });

  return NextResponse.json({
    ok: true,
    stripe_synced: stripeSync ? Boolean(stripeSync.synced) : null,
    warning: stripeWarning,
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("supports.manage");
  const admin = createSupabaseAdminClient();
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";
  // 既定は即時停止。次回更新日まで課金を続けたい場合のみ ?at_period_end=1。
  const atPeriodEnd = url.searchParams.get("at_period_end") === "1";

  const { data: current } = await admin
    .from("support_subscriptions")
    .select("id, status, stripe_subscription_item_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "支援が見つかりません" }, { status: 404 });

  // Stripe の課金を必ず先に止める。ハード削除でも同じ — 行だけ消すと、
  // 二度と辿れない subscription item に請求され続ける。
  let stripeSync: any = null;
  let stripeWarning: string | null = null;
  try {
    stripeSync = await syncSupportCancelById({
      support_id: params.id,
      immediate: !atPeriodEnd,
    });
  } catch (e: any) {
    stripeSync = { synced: false, reason: e?.message ?? "stripe_error" };
  }
  if (!stripeSync?.synced) {
    if (!isBenignSyncReason(stripeSync?.reason)) {
      await admin.from("audit_logs").insert({
        actor_id: session.userId,
        action: "support.cancel.sync_failed",
        target_table: "support_subscriptions",
        target_id: params.id,
        meta: { hard, stripe: stripeSync },
      });
      return NextResponse.json(
        {
          error:
            "Stripeの課金停止に失敗したため中止しました。" +
            "停止できないまま記録を消すと請求だけが残り続けます。" +
            `（理由: ${stripeSync?.reason ?? "unknown"}）`,
        },
        { status: 502 },
      );
    }
    stripeWarning =
      "この支援はStripeの自動課金に紐づいていません。請求の停止は手動でご確認ください。";
  }

  if (hard) {
    const { error } = await admin.from("support_subscriptions").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "support.delete",
      target_table: "support_subscriptions",
      target_id: params.id,
      meta: { stripe: stripeSync },
    });
    return NextResponse.json({ ok: true, hard: true, warning: stripeWarning });
  }

  // 期末停止を選んだ場合のみ active のまま停止予定日を持たせる。
  const scheduledAt =
    stripeSync?.mode === "scheduled" ? (stripeSync?.scheduled_cancel_at ?? null) : null;
  const { error } = await admin
    .from("support_subscriptions")
    .update(
      scheduledAt
        ? { canceled_at: scheduledAt }
        : {
            status: "canceled",
            canceled_at: new Date().toISOString(),
            stripe_subscription_item_id: null,
          },
    )
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: scheduledAt ? "support.cancel.scheduled" : "support.cancel",
    target_table: "support_subscriptions",
    target_id: params.id,
    meta: { scheduled_cancel_at: scheduledAt, stripe: stripeSync },
  });

  return NextResponse.json({ ok: true, scheduled_cancel_at: scheduledAt, warning: stripeWarning });
}
