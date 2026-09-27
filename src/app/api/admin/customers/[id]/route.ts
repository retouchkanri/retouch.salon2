import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notify, profileUpdatedTemplate, staffRecipients } from "@/lib/notify";

const patchSchema = z.object({
  full_name: z.string().max(120).optional(),
  full_name_kana: z.string().max(120).optional().nullable(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional().nullable(),
  postal_code: z.string().max(20).optional().nullable(),
  address1: z.string().max(200).optional().nullable(),
  address2: z.string().max(200).optional().nullable(),
  birthday: z.string().optional().nullable(),
  gender: z.enum(["male", "female", "other", "unspecified"]).optional().nullable(),
  status: z.enum(["active", "suspended", "withdrawn"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("customers.manage");
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("customers").update(parsed.data).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "customer.update",
    target_table: "customers",
    target_id: params.id,
    meta: parsed.data,
  });

  // 個人情報（お名前・連絡先・住所など）が変更された場合のみ、会員本人・運営へ通知する。
  // 在籍状態（status）のみの変更では通知しない。メール送信失敗は更新成功に影響させない。
  const personalKeys = [
    "full_name",
    "full_name_kana",
    "email",
    "phone",
    "postal_code",
    "address1",
    "address2",
    "birthday",
    "gender",
  ];
  const changedPersonal = Object.keys(parsed.data).filter((k) => personalKeys.includes(k));
  if (changedPersonal.length > 0) {
    const { data: customer } = await admin
      .from("customers")
      .select("full_name, email")
      .eq("id", params.id)
      .maybeSingle();
    const memberEmail = (customer as any)?.email as string | null | undefined;
    const memberName = (customer as any)?.full_name as string | null;

    if (memberEmail) {
      const memberTpl = profileUpdatedTemplate({ name: memberName });
      await notify({
        kind: "profile_updated",
        to: memberEmail,
        to_name: memberName,
        subject: memberTpl.subject,
        body_text: memberTpl.body_text,
        meta: { customer_id: params.id, source: "admin_customer_update" },
      });
    }

    await notify({
      kind: "staff_notify",
      to: staffRecipients(),
      subject: `【登録情報の変更】${memberName ?? "会員"}`,
      body_text:
        `運営にて会員の登録情報を変更しました。\n\n` +
        `・お名前: ${memberName ?? "—"}\n` +
        `・メール: ${memberEmail ?? "—"}\n` +
        `・変更項目: ${changedPersonal.join(", ")}`,
      reply_to: memberEmail ?? undefined,
      meta: { customer_id: params.id, source: "admin_customer_update" },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("customers.manage");
  const admin = createSupabaseAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("full_name, email")
    .eq("id", params.id)
    .maybeSingle();

  const { error } = await admin.from("customers").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "customer.delete",
    target_table: "customers",
    target_id: params.id,
    meta: { full_name: (customer as any)?.full_name ?? null, email: (customer as any)?.email ?? null },
  });

  return NextResponse.json({ ok: true });
}
