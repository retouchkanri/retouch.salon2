import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/site";
import {
  donationBankTransferTemplate,
  donationThanksTemplate,
  notify,
  staffRecipients,
} from "@/lib/notify";
import { bankTransferInfoText, getBankTransferInfo } from "@/lib/bankTransfer";

const schema = z.object({
  amount: z.number().int().min(100).max(10_000_000),
  message: z.string().max(1000).optional().nullable(),
  donor_name: z.string().max(120).optional().nullable(),
  // Spec: 匿名寄付であっても、履歴統合のためメールは必須取得。
  donor_email: z.string().email("メールアドレスの形式が正しくありません"),
  // 支払方法。既定はカード（従来どおり Stripe）。銀行振込は保留で登録し案内メールを送る。
  payment_method: z.enum(["card", "bank_transfer"]).default("card"),
});

/**
 * Public one-time donation endpoint. Accepts anonymous donations.
 * If the caller is a logged-in member, the donation is attached to
 * their customer record automatically.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const { amount, message, donor_name, donor_email, payment_method } = parsed.data;

  const admin = createSupabaseAdminClient();
  const session = await getSession();
  let customerId: string | null = session?.customerId ?? null;

  // If anonymous donor supplied an email that matches a known customer,
  // link to that customer for history aggregation.
  if (!customerId && donor_email) {
    const { data: match } = await admin
      .from("customers")
      .select("id")
      .eq("email", donor_email)
      .maybeSingle();
    customerId = (match as any)?.id ?? null;
  }

  const { data: inserted, error: dErr } = await admin
    .from("donations")
    .insert({
      customer_id: customerId,
      donor_name: donor_name ?? null,
      donor_email: donor_email ?? session?.email ?? null,
      amount,
      message: message ?? null,
      status: "pending",
      payment_method,
    })
    .select("id")
    .single();
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  // ── 銀行振込 ── Stripe を介さず保留のまま登録し、振込先の案内メールを送る。
  // 入金確認後に管理画面（/admin/donations）で「成功」にすると、お礼メールと
  // 決済(payments)行が作成される（donations PATCH の挙動）。
  if (payment_method === "bank_transfer") {
    const bank = getBankTransferInfo();
    const recipient = donor_email ?? session?.email ?? null;
    if (recipient) {
      const tpl = donationBankTransferTemplate({
        name: donor_name ?? null,
        amount,
        bankInfoText: bankTransferInfoText(bank),
      });
      await notify({
        kind: "donation_bank_transfer",
        to: recipient,
        to_name: donor_name ?? null,
        subject: tpl.subject,
        body_text: tpl.body_text,
        meta: { donation_id: inserted.id, source: "donation", payment_method },
      });
    }
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【寄付 銀行振込・入金待ち】${donor_name ?? "匿名"} 様 — ${`¥${Math.round(amount).toLocaleString("ja-JP")}`}`,
      body_text:
        `単発寄付（銀行振込）のお申し込みがありました。入金確認後、管理画面で「成功」に更新してください。\n\n` +
        `・お名前: ${donor_name ?? "（匿名）"}\n` +
        `・メール: ${recipient ?? "—"}\n` +
        `・金額: ¥${Math.round(amount).toLocaleString("ja-JP")}\n` +
        (message ? `・メッセージ: ${message}\n` : ""),
      reply_to: recipient ?? undefined,
      meta: { donation_id: inserted.id, source: "donation", payment_method },
    });
    return NextResponse.json({ ok: true, bank_transfer: true });
  }

  const stripe = getStripe();
  const siteUrl = getBaseUrl(req);
  const returnBase = session ? "/mypage/donate" : "/donate";

  if (!stripe) {
    // Dev mode: mark succeeded instantly and send thank-you
    await admin.from("donations").update({ status: "succeeded" }).eq("id", inserted.id);
    const tpl = donationThanksTemplate({ name: donor_name ?? null, amount });
    await notify({
      kind: "donation_thanks",
      to: donor_email ?? session?.email ?? null,
      to_name: donor_name ?? null,
      subject: tpl.subject,
      body_text: tpl.body_text,
      meta: { donation_id: inserted.id, dev_mode: true },
    });
    // 運営への寄付受領通知（送信失敗は処理に影響させない）
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【寄付】${donor_name ?? "匿名"} 様 — ¥${Math.round(amount).toLocaleString("ja-JP")}`,
      body_text:
        `単発寄付を受け付けました。\n\n` +
        `・お名前: ${donor_name ?? "（匿名）"}\n` +
        `・メール: ${donor_email ?? session?.email ?? "—"}\n` +
        `・金額: ¥${Math.round(amount).toLocaleString("ja-JP")}\n` +
        (message ? `・メッセージ: ${message}\n` : ""),
      reply_to: donor_email ?? session?.email ?? undefined,
      meta: { donation_id: inserted.id, dev_mode: true, source: "donation" },
    });
    return NextResponse.json({ ok: true, checkout_url: null });
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "jpy",
          unit_amount: amount,
          product_data: { name: "Retouchメンバーズサイト 単発寄付" },
        },
      },
    ],
    client_reference_id: inserted.id,
    metadata: {
      donation_id: inserted.id,
      customer_id: customerId ?? "",
      donor_name: donor_name ?? "",
      kind: "donation",
    },
    success_url: `${siteUrl}${returnBase}/thanks?sid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}${returnBase}`,
    customer_email: donor_email ?? session?.email ?? undefined,
  });

  await admin
    .from("donations")
    .update({ stripe_checkout_session_id: checkout.id })
    .eq("id", inserted.id);

  return NextResponse.json({ ok: true, checkout_url: checkout.url });
}
