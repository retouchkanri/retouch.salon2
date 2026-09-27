import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { donationThanksTemplate, notify, staffRecipients } from "@/lib/notify";

const schema = z.object({
  customer_id: z.string().uuid().optional().nullable(),
  donor_name: z.string().max(120).optional().nullable(),
  donor_email: z.string().email().optional().nullable(),
  amount: z.coerce.number().int().positive(),
  message: z.string().max(1000).optional().nullable(),
  status: z
    .enum(["succeeded", "failed", "pending", "refunded", "canceled"])
    .default("pending"),
  payment_method: z.enum(["card", "bank_transfer"]).default("card"),
  confirmed_at: z.string().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  donated_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const session = await requireCapability("donations.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const admin = createSupabaseAdminClient();

  let donor_name = parsed.data.donor_name;
  let donor_email = parsed.data.donor_email;
  if (parsed.data.customer_id) {
    const { data: customer } = await admin
      .from("customers")
      .select("full_name, email")
      .eq("id", parsed.data.customer_id)
      .maybeSingle();
    if (customer) {
      donor_name = donor_name ?? (customer.full_name as string);
      donor_email = donor_email ?? (customer.email as string | null);
    }
  }

  const confirmedAt = parsed.data.confirmed_at || null;
  // 銀行振込は入金確認の有無で状態を確定する。
  //   入金確認日なし → 保留 / 入金確認日あり → 成功。
  // （カード・失敗・返金・取消はそのまま尊重する。）
  let status = parsed.data.status;
  if (parsed.data.payment_method === "bank_transfer") {
    if (!confirmedAt && status === "succeeded") status = "pending";
    else if (confirmedAt && status === "pending") status = "succeeded";
  }

  const { data: inserted, error } = await admin
    .from("donations")
    .insert({
      customer_id: parsed.data.customer_id ?? null,
      donor_name: donor_name ?? null,
      donor_email: donor_email ?? null,
      amount: parsed.data.amount,
      message: parsed.data.message ?? null,
      status,
      payment_method: parsed.data.payment_method,
      confirmed_at: confirmedAt,
      note: parsed.data.note ?? null,
      donated_at: parsed.data.donated_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  if (status === "succeeded") {
    await admin.from("payments").insert({
      customer_id: parsed.data.customer_id ?? null,
      donation_id: inserted.id,
      kind: "donation",
      amount: parsed.data.amount,
      status: "succeeded",
      occurred_at: parsed.data.donated_at ?? new Date().toISOString(),
    });
  }

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "donation.create",
    target_table: "donations",
    target_id: inserted.id,
    meta: { amount: parsed.data.amount, status },
  });

  // 入金が確定（succeeded）した寄付のみ、寄付者へお礼・運営へ受領を通知する。
  // 保留（pending：銀行振込の入金待ち等）の段階では通知しない。送信失敗は登録に影響させない。
  if (status === "succeeded") {
    if (donor_email) {
      const tpl = donationThanksTemplate({ name: donor_name ?? null, amount: parsed.data.amount });
      await notify({
        kind: "donation_thanks",
        to: donor_email,
        to_name: donor_name ?? null,
        subject: tpl.subject,
        body_text: tpl.body_text,
        meta: { donation_id: inserted.id, source: "admin_donation" },
      });
    }
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【寄付】${donor_name ?? "匿名"} 様 — ¥${Math.round(parsed.data.amount).toLocaleString("ja-JP")}`,
      body_text:
        `寄付を登録しました（${parsed.data.payment_method === "bank_transfer" ? "銀行振込" : "カード"}）。\n\n` +
        `・お名前: ${donor_name ?? "（匿名）"}\n` +
        `・メール: ${donor_email ?? "—"}\n` +
        `・金額: ¥${Math.round(parsed.data.amount).toLocaleString("ja-JP")}\n` +
        (parsed.data.message ? `・メッセージ: ${parsed.data.message}\n` : ""),
      reply_to: donor_email ?? undefined,
      meta: { donation_id: inserted.id, source: "admin_donation" },
    });
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
