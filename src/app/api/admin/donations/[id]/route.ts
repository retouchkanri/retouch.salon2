import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { donationThanksTemplate, notify, staffRecipients } from "@/lib/notify";

const patchSchema = z.object({
  amount: z.coerce.number().int().positive().optional(),
  message: z.string().max(1000).optional().nullable(),
  status: z
    .enum(["succeeded", "failed", "pending", "refunded", "canceled"])
    .optional(),
  donor_name: z.string().max(120).optional().nullable(),
  donor_email: z.string().email().optional().nullable(),
  payment_method: z.enum(["card", "bank_transfer"]).optional(),
  confirmed_at: z.string().optional().nullable(),
  donated_at: z.string().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("donations.manage");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();

  // 既存レコードを取得し、部分更新後の最終状態で銀行振込の整合性を確定する。
  const { data: existing } = await admin
    .from("donations")
    .select("customer_id, amount, status, payment_method, confirmed_at, donated_at, donor_name, donor_email, message")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "寄付が見つかりません" }, { status: 404 });

  const patch: Record<string, unknown> = { ...parsed.data };
  if (patch.confirmed_at === "") patch.confirmed_at = null;
  // 日時（寄付日）: 日付(YYYY-MM-DD)を受け取り、JST正午のタイムスタンプとして保存。
  // donated_at は NOT NULL なので、空のときは更新対象から外す。
  if (typeof patch.donated_at === "string" && patch.donated_at.trim() !== "") {
    const d = patch.donated_at.trim();
    patch.donated_at = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00+09:00` : d;
  } else {
    delete patch.donated_at;
  }

  // 部分更新をマージした最終状態。
  const method = (patch.payment_method ?? (existing as any).payment_method) as string;
  const confirmedAt = ("confirmed_at" in patch ? patch.confirmed_at : (existing as any).confirmed_at) as
    | string
    | null;
  let status = (patch.status ?? (existing as any).status) as string;
  // 銀行振込は入金確認の有無で状態を確定（成功⇔保留のみ。失敗・返金・取消は尊重）。
  if (method === "bank_transfer") {
    if (!confirmedAt && status === "succeeded") status = "pending";
    else if (confirmedAt && status === "pending") status = "succeeded";
  }
  patch.status = status;

  const { error } = await admin.from("donations").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 収益(payments)との整合：成功になったら寄付の決済行を1件だけ用意し、
  // 成功でなくなったらその寄付の決済行を取り除く（二重計上・計上漏れ防止）。
  if (status === "succeeded") {
    const { data: existingPay } = await admin
      .from("payments")
      .select("id")
      .eq("donation_id", params.id)
      .limit(1)
      .maybeSingle();
    if (!existingPay) {
      const amount = (patch.amount ?? (existing as any).amount) as number;
      const occurredAt = (patch.donated_at ?? (existing as any).donated_at ?? new Date().toISOString()) as string;
      await admin.from("payments").insert({
        customer_id: (existing as any).customer_id ?? null,
        donation_id: params.id,
        kind: "donation",
        amount,
        status: "succeeded",
        occurred_at: occurredAt,
      });
    }
  } else {
    await admin.from("payments").delete().eq("donation_id", params.id);
  }

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "donation.update",
    target_table: "donations",
    target_id: params.id,
    meta: { ...parsed.data, status },
  });

  // 「保留→入金確定（succeeded）」に切り替わった時のみ通知する。
  // 既に succeeded の寄付を再編集しても重複送信しない。送信失敗は更新に影響させない。
  const becameSucceeded = (existing as any).status !== "succeeded" && status === "succeeded";
  if (becameSucceeded) {
    const finalAmount = (patch.amount ?? (existing as any).amount) as number;
    const donorName = (patch.donor_name ?? (existing as any).donor_name ?? null) as string | null;
    const donorEmail = (patch.donor_email ?? (existing as any).donor_email ?? null) as string | null;
    const finalMessage = (patch.message ?? (existing as any).message ?? null) as string | null;

    if (donorEmail) {
      const tpl = donationThanksTemplate({ name: donorName, amount: finalAmount });
      await notify({
        kind: "donation_thanks",
        to: donorEmail,
        to_name: donorName,
        subject: tpl.subject,
        body_text: tpl.body_text,
        meta: { donation_id: params.id, source: "admin_donation" },
      });
    }
    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【寄付 入金確定】${donorName ?? "匿名"} 様 — ¥${Math.round(finalAmount).toLocaleString("ja-JP")}`,
      body_text:
        `寄付の入金が確定しました（${method === "bank_transfer" ? "銀行振込" : "カード"}）。\n\n` +
        `・お名前: ${donorName ?? "（匿名）"}\n` +
        `・メール: ${donorEmail ?? "—"}\n` +
        `・金額: ¥${Math.round(finalAmount).toLocaleString("ja-JP")}\n` +
        (finalMessage ? `・メッセージ: ${finalMessage}\n` : ""),
      reply_to: donorEmail ?? undefined,
      meta: { donation_id: params.id, source: "admin_donation" },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("donations.manage");
  const admin = createSupabaseAdminClient();

  // 紐づく決済(payments)行を先に削除する。payments.donation_id は ON DELETE
  // SET NULL のため、寄付を先に消すと決済行が「種別=寄付」のまま顧客の決済履歴に
  // 取り残される（PATCH で成功でなくなった時の挙動と揃える）。
  await admin.from("payments").delete().eq("donation_id", params.id);

  const { error } = await admin.from("donations").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "donation.delete",
    target_table: "donations",
    target_id: params.id,
  });

  return NextResponse.json({ ok: true });
}
