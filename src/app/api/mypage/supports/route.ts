import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { probeSupportItem, syncSupportCreate } from "@/lib/stripeSupport";
import { SUPPORT_UNIT_PRICE, isBasicMemberPlanCode } from "@/lib/constraints";
import { notify, staffRecipients, supportAddedTemplate } from "@/lib/notify";
import { getStripe } from "@/lib/stripe";

const schema = z.object({
  horse_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  units: z
    .number()
    .positive()
    .max(100)
    .refine((v) => Number.isInteger(v * 2), "口数は0.5口刻みで指定してください"),
  cancel_contract_id: z.string().uuid().optional().nullable(),
});

export async function POST(req: Request) {
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
  const { horse_id, plan_id, units, cancel_contract_id } = parsed.data;

  const supabase = createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const [{ data: plan }, { data: horse }, { data: customer }] = await Promise.all([
    supabase.from("membership_plans").select("*").eq("id", plan_id).maybeSingle(),
    supabase.from("horses").select("*").eq("id", horse_id).maybeSingle(),
    admin
      .from("customers")
      .select("id, email, full_name, stripe_customer_id")
      .eq("id", session.customerId)
      .maybeSingle(),
  ]);
  if (!plan || plan.code !== "SUPPORT") {
    return NextResponse.json({ error: "支援プランが正しくありません" }, { status: 400 });
  }
  if (!horse || !horse.is_supportable) {
    return NextResponse.json({ error: "この馬は現在支援を受け付けていません" }, { status: 400 });
  }
  if (!customer) {
    return NextResponse.json({ error: "会員情報が見つかりません" }, { status: 404 });
  }

  // 併用制約チェック（基本会員区分 A/B/C/OWNER と支援会員は併用不可）
  //
  // RPT 等は支援会員と併用できるため、顧客が active/past_due の契約を複数
  // 持っているケースは正常にあり得る。以前は .maybeSingle() で1件のみ取得
  // していたため、複数件ヒットすると（エラーになり）null 扱いとなり、
  // 既存の支援契約を見つけられず毎回新しい契約＋Stripeサブスクリプションを
  // 作成してしまうバグがあった（1顧客が馬を追加するたびに別々のサブスク
  // リプションが増殖し、"item already using that Price" 等の同期エラーを
  // 誘発していた）。全件取得してプランコードで目的別に判定する。
  //
  // `incomplete` も取得すること。支援サブスクリプションは
  // `payment_behavior: "default_incomplete"` で作成されるため、作成直後の
  // 正常な状態が incomplete である。以前は active/past_due しか見ていなかった
  // ので、初回決済が完了する前に2頭目を追加すると既存契約が「無い」と判定され、
  // 2本目の契約＋2本目の Stripe サブスクリプションが作られていた
  // （2026-09報告: 別カード2枚にそれぞれ4口＝48,000円が請求された原因）。
  const { data: contractRows } = await supabase
    .from("contracts")
    .select("*, plan:membership_plans(code, name)")
    .eq("customer_id", session.customerId)
    .in("status", ["active", "past_due", "incomplete"]);
  const allContracts = contractRows ?? [];
  // 併用不可判定は従来どおり「有効な」基本会員契約のみを対象にする
  //（未決済のまま放置された incomplete 契約で申込をブロックしない）。
  const basicContract = allContracts.find(
    (c: any) => c.status !== "incomplete" && isBasicMemberPlanCode(c.plan?.code),
  );
  // 既存の支援会員契約を再利用する。Stripeサブスクリプション済みのものを
  // 優先し、複数の支援契約が残っている場合でも新規契約を作らず1つに集約する。
  const supportContracts = allContracts.filter((c: any) => c.plan?.code === "SUPPORT");
  const activeContract =
    supportContracts.find((c: any) => c.stripe_subscription_id) ?? supportContracts[0] ?? null;
  const basicCode = (basicContract as any)?.plan?.code as string | undefined;
  if (basicCode && isBasicMemberPlanCode(basicCode)) {
    const conflictId = (basicContract as any)?.id as string;
    // クライアントから cancel_contract_id が送られてきた場合は自動解約して続行する。
    // ID が一致していることを確認してから処理（なりすまし防止）。
    if (!cancel_contract_id || cancel_contract_id !== conflictId) {
      return NextResponse.json(
        { error: "メンバーズ会員・サポーター会員・リェリーフ会員とヘルパーズ会員（一口支援・半口支援）は併用できません。現在の会員種別を変更してください。" },
        { status: 400 },
      );
    }

    // Stripe サブスクリプションのキャンセル（存在する場合）
    const stripeSubId = (basicContract as any)?.stripe_subscription_id as string | null;
    if (stripeSubId) {
      const stripe = getStripe();
      if (stripe) {
        try {
          await stripe.subscriptions.cancel(stripeSubId, { prorate: true });
        } catch {
          // Stripe側で既にキャンセル済みの場合は無視して続行
        }
      }
    }

    // DB の契約ステータスを canceled に更新
    await admin
      .from("contracts")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", conflictId);

    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: "contract.cancel",
      target_table: "contracts",
      target_id: conflictId,
      meta: { reason: "auto_cancel_for_support_signup" },
    });
  }

  type ContractRef = { id: string; stripe_subscription_id: string | null; status: string };
  const toRef = (c: any): ContractRef => ({
    id: c.id,
    stripe_subscription_id: c.stripe_subscription_id ?? null,
    status: c.status,
  });

  // 1頭＝1サブスクリプション: 新しい馬の支援は、その馬専用の支援契約で請求する
  // （既存のサブスクリプションへ追加すると、初月が日割りの端数になり、1頭だけの
  // 停止もできなくなるため。stripeSupport.ts の ensureDedicatedContract を参照）。
  // 請求も支援行も付いていない空の支援契約（前回の申込が途中で終わった等）があれば
  // 再利用し、無ければ新しく作る。
  const contractForNewSupport = async (): Promise<ContractRef | null> => {
    for (const c of supportContracts) {
      if ((c as any).stripe_subscription_id) continue;
      const { count, error } = await admin
        .from("support_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("contract_id", (c as any).id)
        .in("status", ["active", "past_due", "incomplete"]);
      if (!error && (count ?? 0) === 0) return toRef(c);
    }
    const { data: created, error: cErr } = await admin
      .from("contracts")
      .insert({
        customer_id: session.customerId,
        plan_id: plan.id,
        status: "active",
        current_period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      })
      .select("id, stripe_subscription_id, status")
      .single();
    if (cErr || !created) return null;
    return toRef(created);
  };

  // 既存の支援に口数を足す場合は、その支援行が実際に請求されている契約を使う。
  const contractOfRow = async (contractIdOfRow: string | null): Promise<ContractRef | null> => {
    if (contractIdOfRow) {
      const { data } = await admin
        .from("contracts")
        .select("id, stripe_subscription_id, status")
        .eq("id", contractIdOfRow)
        .maybeSingle();
      if (data) return toRef(data);
    }
    return activeContract ? toRef(activeContract) : contractForNewSupport();
  };

  let contractId: string | null = (activeContract as any)?.id ?? null;

  // Authoritative per-口 price. Never price off the selected plan's own
  // unit_amount (半口=6,000) — a half share is units=0.5 at 12,000/口.
  const perUnit = SUPPORT_UNIT_PRICE;

  // --- Consolidation: if this customer already has a live support row for the
  // same horse, update units/monthly on that row instead of inserting a
  // duplicate. This guarantees 1 live row per (customer, horse).
  //
  // `incomplete` must be included: a first attempt that ended at the hosted
  // invoice (or failed to sync) leaves the row incomplete, and excluding it
  // made every retry insert a SECOND row — and therefore a second Stripe item
  // — for the same horse. `.maybeSingle()` is also avoided on purpose: it
  // returns null when duplicates already exist, which used to make the code
  // add yet another row on top of them.
  const { data: existingRows } = await admin
    .from("support_subscriptions")
    .select("id, contract_id, units, monthly_amount, status, canceled_at, stripe_subscription_item_id, horse:horses(name)")
    .eq("customer_id", session.customerId)
    .eq("horse_id", horse.id)
    .in("status", ["active", "past_due", "incomplete"])
    .order("started_at", { ascending: false });
  // Prefer the row Stripe actually knows about, then the newest.
  const existingRow =
    (existingRows ?? []).find((r: any) => r.stripe_subscription_item_id) ??
    (existingRows ?? [])[0] ??
    null;

  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  if (existingRow) {
    // ADD vs REPLACE.
    //
    // Adding 口数 is only correct when the member is topping up support that is
    // genuinely being billed right now. If the row is a leftover — never
    // completed (`incomplete`), already scheduled to stop (`canceled_at`), or
    // pointing at a Stripe item that no longer exists (staff cancelled/refunded
    // in the Stripe dashboard, which fires no per-item webhook) — then this
    // request is a RE-registration and the requested 口数 is the whole amount.
    //
    // The old code always added. That is what turned "re-register 半口 for 3
    // horses" into 1口 each: 0.5 (zombie row) + 0.5 (new) = 1.0 → Stripe
    // quantity 2 → ¥12,000/horse instead of ¥6,000 (reported 2026-09).
    const prevUnits = Number((existingRow as any).units);
    const prevMonthly = Number((existingRow as any).monthly_amount);
    const prevStatus = (existingRow as any).status as string;
    const existingItemId = ((existingRow as any).stripe_subscription_item_id as string | null) ?? null;
    //
    // A row with NO item id is a staff-registered support that is invoiced
    // manually — it is genuinely live, so adding is still correct there. Only
    // a row whose stored item id has gone dead counts as a re-registration.
    //
    // If Stripe cannot be reached we must NOT pick a side: guessing "dead"
    // wipes out 口数 the member is paying for, guessing "live" doubles their
    // bill. Abort and let them retry instead.
    let itemIsDead = false;
    if (stripeEnabled && existingItemId) {
      const probe = await probeSupportItem(existingItemId);
      if (probe === "unknown") {
        return NextResponse.json(
          {
            error:
              "決済状況を確認できなかったため、申し込みを中断しました。時間をおいて再度お試しください。",
          },
          { status: 502 },
        );
      }
      itemIsDead = probe === "dead";
    }
    const isLiveBilling =
      prevStatus !== "incomplete" && !(existingRow as any).canceled_at && !itemIsDead;

    const newUnits = isLiveBilling ? prevUnits + Number(units) : Number(units);
    const newMonthly = Math.round(perUnit * newUnits);

    const mergeContract = await contractOfRow(((existingRow as any).contract_id as string | null) ?? null);
    if (!mergeContract) {
      return NextResponse.json({ error: "契約の作成に失敗しました" }, { status: 500 });
    }
    contractId = mergeContract.id;

    // --- 先に DB を仮保存 (incomplete = 手続き中) ---
    const { error: uErr } = await admin
      .from("support_subscriptions")
      .update({ units: newUnits, monthly_amount: newMonthly, status: "incomplete" })
      .eq("id", (existingRow as any).id);
    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    // Restore the row exactly as it was if Stripe never accepted the change.
    // Without this, a failed attempt still permanently raised `units`, so a
    // member who pressed 申し込む twice after an error ended up billed for
    // double the 口数 they asked for.
    //
    // Only roll back when Stripe is provably NOT billing the new amount.
    // `syncSupportCreate` writes the new item id onto the row as soon as it
    // creates one, so a changed item id means an item exists at `newMonthly` —
    // resetting `units` there would recreate the very DB/Stripe divergence
    // this whole change is about.
    const rollback = async () => {
      const { data: after } = await admin
        .from("support_subscriptions")
        .select("stripe_subscription_item_id")
        .eq("id", (existingRow as any).id)
        .maybeSingle();
      const itemNow = ((after as any)?.stripe_subscription_item_id as string | null) ?? null;
      if (itemNow !== existingItemId) return; // a new item was billed — keep DB in step with it
      await admin
        .from("support_subscriptions")
        .update({ units: prevUnits, monthly_amount: prevMonthly, status: prevStatus })
        .eq("id", (existingRow as any).id);
    };

    let sync;
    let syncError: string | null = null;
    try {
      sync = await syncSupportCreate({
        customer: customer as any,
        contract: mergeContract,
        support: {
          id: (existingRow as any).id,
          horse_id: horse.id,
          horse_name: horse.name,
          monthly_amount: newMonthly,
        },
        existing_item_id: existingItemId,
      });
      if (sync?.contract_id) contractId = sync.contract_id;
    } catch (e: any) {
      sync = { synced: false, reason: e?.message ?? "stripe_error" };
      syncError = e?.message ?? "Stripeとの同期に失敗しました";
    }

    const requiresStripePayment = Boolean(stripeEnabled && sync?.requires_payment);
    // Stripe決済アクションが必要な間は incomplete のまま保持し、支払いページへ誘導する。
    const canActivate = (sync?.synced && !requiresStripePayment) || !stripeEnabled;
    const syncFailed = stripeEnabled && !sync?.synced;
    if (syncFailed) {
      await rollback();
    } else {
      await admin
        .from("support_subscriptions")
        .update({ status: canActivate ? "active" : "incomplete" })
        .eq("id", (existingRow as any).id);
    }

    await admin.from("audit_logs").insert({
      actor_id: session.userId,
      action: canActivate ? "support.merge" : requiresStripePayment ? "support.merge.requires_payment" : "support.merge.sync_failed",
      target_table: "support_subscriptions",
      target_id: (existingRow as any).id,
      meta: {
        horse_id,
        horse_name: horse.name,
        plan_id,
        mode: isLiveBilling ? "add" : "replace",
        prev_units: prevUnits,
        added_units: units,
        new_units: newUnits,
        monthly: newMonthly,
        rolled_back: syncFailed,
        stripe: sync,
      },
    });

    if (requiresStripePayment) {
      return NextResponse.json({
        ok: true,
        contract_id: contractId,
        support_id: (existingRow as any).id,
        consolidated: true,
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
            "決済の同期に失敗したため、支援の追加を確定できませんでした。時間をおいて再度お試しください。",
        },
        { status: 502 },
      );
    }

    const tplMerge = supportAddedTemplate({
      name: (customer as any).full_name,
      horseName: horse.name,
      units: newUnits,
      monthly: newMonthly,
      // 請求中の支援への追加は、次回の請求日から新しい月額になる（日割りなし）
      effectiveFrom: sync?.effective_from ?? null,
    });
    await notify({
      kind: "support_added",
      to: (customer as any).email,
      to_name: (customer as any).full_name,
      subject: tplMerge.subject,
      body_text: tplMerge.body_text,
      meta: { support_id: (existingRow as any).id, horse_name: horse.name, units: newUnits },
    });

    // スタッフへの支援申込通知（追加口数マージ）
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【一口支援 申込】${(customer as any).full_name} — ${horse.name}`,
      body_text:
        `一口支援のお申し込みがありました（既存支援への追加）。\n\n` +
        `・会員名: ${(customer as any).full_name}\n` +
        `・メール: ${(customer as any).email}\n` +
        `・対象馬: ${horse.name}\n` +
        `・口数（合計）: ${newUnits}口\n` +
        `・月額: ¥${Math.round(newMonthly).toLocaleString("ja-JP")}`,
      reply_to: (customer as any).email,
      meta: { support_id: (existingRow as any).id, horse_name: horse.name, units: newUnits, source: "support_merge" },
    });

    return NextResponse.json({
      ok: true,
      contract_id: contractId,
      support_id: (existingRow as any).id,
      consolidated: true,
      stripe: sync,
    });
  }

  const monthly = Math.round(perUnit * Number(units));
  const newContract = await contractForNewSupport();
  if (!newContract) {
    return NextResponse.json({ error: "契約の作成に失敗しました" }, { status: 500 });
  }
  contractId = newContract.id;
  const { data: inserted, error: sErr } = await admin
    .from("support_subscriptions")
    .insert({
      contract_id: contractId,
      customer_id: session.customerId,
      horse_id: horse.id,
      units,
      monthly_amount: monthly,
      status: "incomplete",
    })
    .select("id")
    .single();
  if (sErr || !inserted) return NextResponse.json({ error: sErr?.message ?? "failed" }, { status: 500 });

  let sync;
  let syncError: string | null = null;
  try {
    sync = await syncSupportCreate({
      customer: customer as any,
      contract: newContract,
      support: {
        id: inserted.id,
        horse_id: horse.id,
        horse_name: horse.name,
        monthly_amount: monthly,
      },
      existing_item_id: null,
    });
    if (sync?.contract_id) contractId = sync.contract_id;
  } catch (e: any) {
    sync = { synced: false, reason: e?.message ?? "stripe_error" };
    syncError = e?.message ?? "Stripeとの同期に失敗しました";
  }

  const requiresStripePayment = Boolean(stripeEnabled && sync?.requires_payment);
  const canActivate = (sync?.synced && !requiresStripePayment) || !stripeEnabled;
  // Stripe never took the row: close it out so it stops counting as live
  // support, stops blocking the one-live-row-per-horse rule, and cannot be
  // picked up as an "existing row" to add 口数 onto when the member retries.
  //
  // But only when nothing is actually being billed for it. `syncSupportCreate`
  // stamps the item id onto the row the moment it creates one, so a row that
  // now carries an item id IS billed — closing it there would leave an orphan
  // Stripe item charging a member with no support record behind it.
  let syncFailed = stripeEnabled && !sync?.synced;
  if (syncFailed) {
    const { data: after } = await admin
      .from("support_subscriptions")
      .select("stripe_subscription_item_id")
      .eq("id", inserted.id)
      .maybeSingle();
    if ((after as any)?.stripe_subscription_item_id) syncFailed = false;
  }
  await admin
    .from("support_subscriptions")
    .update(
      syncFailed
        ? { status: "canceled", canceled_at: new Date().toISOString() }
        : { status: canActivate ? "active" : "incomplete" },
    )
    .eq("id", inserted.id);

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: canActivate ? "support.create" : requiresStripePayment ? "support.create.requires_payment" : "support.create.sync_failed",
    target_table: "support_subscriptions",
    target_id: inserted.id,
    meta: { horse_id, horse_name: horse.name, plan_id, units, monthly, rolled_back: syncFailed, stripe: sync },
  });

  if (requiresStripePayment) {
    return NextResponse.json({
      ok: true,
      contract_id: contractId,
      support_id: inserted.id,
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
          "決済の同期に失敗したため、支援の登録を確定できませんでした。時間をおいて再度お試しください。",
      },
      { status: 502 },
    );
  }

  const tpl = supportAddedTemplate({
    name: (customer as any).full_name,
    horseName: horse.name,
    units: Number(units),
    monthly,
  });
  await notify({
    kind: "support_added",
    to: (customer as any).email,
    to_name: (customer as any).full_name,
    subject: tpl.subject,
    body_text: tpl.body_text,
    meta: { support_id: inserted.id, horse_name: horse.name, units },
  });

  // スタッフへの支援申込通知（新規）
  await notify({
    kind: "staff_notify",
    to: staffRecipients(),
    subject: `【一口支援 申込】${(customer as any).full_name} — ${horse.name}`,
    body_text:
      `一口支援の新規お申し込みがありました。\n\n` +
      `・会員名: ${(customer as any).full_name}\n` +
      `・メール: ${(customer as any).email}\n` +
      `・対象馬: ${horse.name}\n` +
      `・口数: ${Number(units)}口\n` +
      `・月額: ¥${Math.round(monthly).toLocaleString("ja-JP")}`,
    reply_to: (customer as any).email,
    meta: { support_id: inserted.id, horse_name: horse.name, units, source: "support_create" },
  });

  return NextResponse.json({
    ok: true,
    contract_id: contractId,
    support_id: inserted.id,
    stripe: sync,
  });
}
