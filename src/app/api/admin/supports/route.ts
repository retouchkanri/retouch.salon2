import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isBasicMemberPlanCode, SUPPORT_UNIT_PRICE } from "@/lib/constraints";
import { notify, staffRecipients, supportAddedTemplate } from "@/lib/notify";

const schema = z.object({
  // 顧客ID（UUID）またはメールアドレスのどちらでも受け付ける。
  customer_id: z.string().trim().min(1),
  horse_id: z.string().uuid(),
  units: z.coerce.number().positive().max(99),
});

export async function POST(req: Request) {
  const session = await requireCapability("supports.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const { horse_id, units } = parsed.data;
  const admin = createSupabaseAdminClient();

  // 入力された識別子から顧客を特定する。
  //   - UUID形式 → 顧客ID（customers.id）で照合
  //   - "@" を含む → メールアドレスで大文字小文字を無視して照合
  //   - それ以外 → 入力不正
  const identifier = parsed.data.customer_id.trim();
  let resolvedId: string | null = null;
  if (z.string().uuid().safeParse(identifier).success) {
    const { data } = await admin
      .from("customers")
      .select("id")
      .eq("id", identifier)
      .maybeSingle();
    resolvedId = data?.id ?? null;
  } else if (identifier.includes("@")) {
    // ilike のワイルドカード(%/_)とエスケープ文字(\)をリテラル化し、完全一致で照合する。
    const escaped = identifier.replace(/([\\%_])/g, "\\$1");
    const { data } = await admin
      .from("customers")
      .select("id")
      .ilike("email", escaped)
      .limit(2);
    if (data && data.length > 1) {
      return NextResponse.json(
        { error: "同じメールアドレスの顧客が複数登録されています。顧客IDで指定してください。" },
        { status: 409 },
      );
    }
    resolvedId = data?.[0]?.id ?? null;
  } else {
    return NextResponse.json(
      { error: "顧客IDまたはメールアドレスを入力してください" },
      { status: 400 },
    );
  }
  if (!resolvedId) {
    return NextResponse.json({ error: "顧客が見つかりません" }, { status: 404 });
  }
  const customer_id = resolvedId;

  const { data: horse } = await admin
    .from("horses")
    .select("id, name, is_supportable")
    .eq("id", horse_id)
    .maybeSingle();
  if (!horse) return NextResponse.json({ error: "馬が見つかりません" }, { status: 404 });
  if (!horse.is_supportable) {
    return NextResponse.json({ error: "この馬は支援対象外です" }, { status: 400 });
  }

  // 同じ馬の支援行が既に生きている場合は二重登録しない。
  // 支援数・月額の二重計上、Stripe item の重複作成の温床になる。
  const { data: dupRows } = await admin
    .from("support_subscriptions")
    .select("id, units, status")
    .eq("customer_id", customer_id)
    .eq("horse_id", horse_id)
    .in("status", ["active", "past_due", "incomplete"])
    .limit(1);
  if ((dupRows ?? []).length > 0) {
    return NextResponse.json(
      {
        error:
          `この会員には既に「${horse.name}」の支援が登録されています（${Number((dupRows as any)[0].units)}口）。` +
          "重複登録ではなく、既存の支援の口数を編集してください。",
        support_id: (dupRows as any)[0].id,
      },
      { status: 409 },
    );
  }

  // 支援行は必ず SUPPORT 契約にぶら下げる。
  // 以前は「最新の active 契約」を無条件に採用していたため、リタポ(RPT)や
  // 特別チームの契約に支援行が紐づくことがあった。その状態で支援を停止すると
  // contract.stripe_subscription_id 経由で無関係のサブスクリプションを
  // 解約しかねず、請求内訳も別会員種別と混ざる。
  const { data: customerContracts } = await admin
    .from("contracts")
    .select("id, plan_id, status, stripe_subscription_id, plan:membership_plans(code)")
    .eq("customer_id", customer_id)
    .in("status", ["active", "past_due", "incomplete"])
    .order("started_at", { ascending: false });

  const basic = (customerContracts ?? []).find(
    (c: any) => c.status !== "incomplete" && isBasicMemberPlanCode(c.plan?.code),
  );
  if (basic) {
    return NextResponse.json(
      { error: "基本会員区分の契約が有効です。先に契約を停止してから支援を追加してください。" },
      { status: 409 },
    );
  }
  // 運営登録（手動請求）の支援行は、Stripe の請求が付いていない支援契約にぶら下げる。
  // 会員の支援は馬ごとに専用の契約（Stripe サブスクリプション）で請求しているため、
  // そこへ手動の行を付けると、その馬の停止・決済失敗の Webhook で無関係の手動の
  // 行まで停止・決済失敗扱いになってしまう。
  const existingContract = (customerContracts ?? []).find(
    (c: any) => c.plan?.code === "SUPPORT" && !c.stripe_subscription_id,
  );

  let contractId = existingContract?.id as string | undefined;
  // Track if we created a new contract in this request so we can roll it back
  // if the subsequent support_subscriptions insert fails (no DB transaction).
  let createdContractId: string | undefined;
  if (!contractId) {
    const { data: supportPlan } = await admin
      .from("membership_plans")
      .select("id")
      .eq("code", "SUPPORT")
      .order("sort_order")
      .limit(1)
      .maybeSingle();
    const { data: created, error: cErr } = await admin
      .from("contracts")
      .insert({
        customer_id,
        plan_id: supportPlan?.id ?? null,
        status: "active",
      })
      .select("id")
      .single();
    if (cErr || !created) {
      return NextResponse.json({ error: "契約作成に失敗しました" }, { status: 500 });
    }
    contractId = created.id;
    createdContractId = created.id;
  }

  // 単価は常に SUPPORT_UNIT_PRICE（1口=12,000円）を正とする。
  // 半口支援プラン自体の unit_amount（6,000円）を使って計算すると
  // 「半額の半額」で3,000円になってしまうため、ここでは絶対に使わない。
  const monthlyAmount = Math.round(SUPPORT_UNIT_PRICE * units);

  const { data: inserted, error: insErr } = await admin
    .from("support_subscriptions")
    .insert({
      contract_id: contractId,
      customer_id,
      horse_id,
      units,
      monthly_amount: monthlyAmount,
      status: "active",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    // Roll back the contract we just created to avoid an orphaned SUPPORT
    // contract with no support_subscriptions (which causes 会員種別=— on the
    // member detail page because v_customer_summary reads from support_subscriptions).
    if (createdContractId) {
      await admin.from("contracts").delete().eq("id", createdContractId);
    }
    return NextResponse.json({ error: insErr?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "support.create",
    target_table: "support_subscriptions",
    target_id: inserted.id,
    meta: { customer_id, horse_id, units, monthly_amount: monthlyAmount },
  });

  // 会員本人・運営の双方へ一口支援の登録を通知する。
  // メール送信に失敗しても登録自体は成功として扱う。
  const { data: customer } = await admin
    .from("customers")
    .select("full_name, email")
    .eq("id", customer_id)
    .maybeSingle();
  const memberEmail = (customer as any)?.email as string | null | undefined;
  const memberName = (customer as any)?.full_name as string | null;
  const horseName = (horse as any)?.name ?? "—";

  if (memberEmail) {
    const memberTpl = supportAddedTemplate({
      name: memberName,
      horseName,
      units: Number(units),
      monthly: monthlyAmount,
      // 運営による手動登録（Stripe自動課金なし）のため、請求案内は別途連絡の文面にする。
      autoBill: false,
    });
    await notify({
      kind: "support_added",
      to: memberEmail,
      to_name: memberName,
      subject: memberTpl.subject,
      body_text: memberTpl.body_text,
      meta: { support_id: inserted.id, horse_name: horseName, units, source: "admin_support_create" },
    });
  }

  await notify({
    kind: "staff_notify",
    to: staffRecipients(),
    subject: `【一口支援 登録】${memberName ?? "会員"} — ${horseName}`,
    body_text:
      `運営にて一口支援を登録しました。\n\n` +
      `・会員名: ${memberName ?? "—"}\n` +
      `・メール: ${memberEmail ?? "—"}\n` +
      `・対象馬: ${horseName}\n` +
      `・口数: ${Number(units)}口\n` +
      `・月額: ¥${Math.round(monthlyAmount).toLocaleString("ja-JP")}`,
    reply_to: memberEmail ?? undefined,
    meta: { support_id: inserted.id, horse_name: horseName, units, source: "admin_support_create" },
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}
