import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncSpecialTeamCreate } from "@/lib/stripeSpecialTeam";
import { SPECIAL_TEAM_NEW_SIGNUPS_ENABLED } from "@/lib/featureFlags";
import { notify, planChangedTemplate } from "@/lib/notify";

const schema = z.object({
  horse_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  // New special-team sign-ups are closed (existing subscribers unaffected).
  if (!SPECIAL_TEAM_NEW_SIGNUPS_ENABLED) {
    return NextResponse.json(
      { error: "現在、特別チーム会員の新規受付を停止しております。" },
      { status: 403 },
    );
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { horse_id } = parsed.data;

  const supabase = createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const [{ data: plan }, { data: horse }, { data: customer }] = await Promise.all([
    supabase.from("membership_plans").select("*").eq("code", "SPECIAL_TEAM").eq("is_active", true).maybeSingle(),
    supabase.from("horses").select("*").eq("id", horse_id).maybeSingle(),
    admin
      .from("customers")
      .select("id, email, full_name, stripe_customer_id")
      .eq("id", session.customerId)
      .maybeSingle(),
  ]);
  if (!plan) {
    return NextResponse.json({ error: "特別チーム会員プランが見つかりません" }, { status: 400 });
  }
  if (!horse || !horse.is_supportable) {
    return NextResponse.json({ error: "この馬は現在受け付けていません" }, { status: 400 });
  }
  if (!customer) {
    return NextResponse.json({ error: "会員情報が見つかりません" }, { status: 404 });
  }

  const monthly = (plan as any).monthly_amount as number;

  // 特別チーム会員はすべてのプランと併用可能。
  // 1馬につき1契約のみ（重複防止）。
  const { data: existing } = await admin
    .from("special_team_memberships")
    .select("id")
    .eq("customer_id", session.customerId)
    .eq("horse_id", horse.id)
    .in("status", ["active", "past_due", "incomplete"])
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "この馬の特別チーム会員にはすでに加入されています。" },
      { status: 409 },
    );
  }

  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  const { data: inserted, error: iErr } = await admin
    .from("special_team_memberships")
    .insert({
      customer_id: session.customerId,
      horse_id: horse.id,
      monthly_amount: monthly,
      status: "incomplete",
    })
    .select("id")
    .single();
  if (iErr || !inserted) {
    return NextResponse.json({ error: iErr?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  let sync;
  let syncError: string | null = null;
  try {
    sync = await syncSpecialTeamCreate({
      customer: customer as any,
      membership: { id: inserted.id, horse_id: horse.id, horse_name: horse.name },
    });
  } catch (e: any) {
    sync = { synced: false, reason: e?.message ?? "stripe_error" };
    syncError = e?.message ?? "Stripeとの同期に失敗しました";
  }

  const requiresStripePayment = Boolean(stripeEnabled && sync?.requires_payment);
  const canActivate = (sync?.synced && !requiresStripePayment) || !stripeEnabled;
  await admin
    .from("special_team_memberships")
    .update({ status: canActivate ? "active" : "incomplete" })
    .eq("id", inserted.id);

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: canActivate
      ? "special_team.create"
      : requiresStripePayment
      ? "special_team.create.requires_payment"
      : "special_team.create.sync_failed",
    target_table: "special_team_memberships",
    target_id: inserted.id,
    meta: { horse_id, horse_name: horse.name, monthly, stripe: sync },
  });

  if (requiresStripePayment) {
    return NextResponse.json({
      ok: true,
      membership_id: inserted.id,
      checkout_url: sync?.checkout_url ?? null,
      requires_payment: true,
      stripe: sync,
    });
  }

  if (!canActivate) {
    return NextResponse.json(
      {
        error:
          syncError ??
          "決済の同期に失敗したため、加入を確定できませんでした。時間をおいて再度お試しください。",
      },
      { status: 502 },
    );
  }

  const tpl = planChangedTemplate({
    name: (customer as any).full_name,
    planName: `特別チーム会員（${horse.name}）`,
    monthly,
  });
  await notify({
    kind: "plan_changed",
    to: (customer as any).email,
    to_name: (customer as any).full_name,
    subject: tpl.subject,
    body_text: tpl.body_text,
    meta: { special_team_id: inserted.id, horse_name: horse.name },
  });

  return NextResponse.json({ ok: true, membership_id: inserted.id, stripe: sync });
}
