import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notify, profileUpdatedTemplate, staffRecipients } from "@/lib/notify";
import { buildCustomerSyncPatch } from "@/lib/registration";

const schema = z.object({
  username: z.string().trim().min(1, "ユーザーネームを入力してください").max(60),
  last_name: z.string().trim().min(1, "姓を入力してください").max(60),
  first_name: z.string().trim().min(1, "名を入力してください").max(60),
  nickname: z.string().trim().max(60).optional(),
  phone: z.string().trim().min(1, "電話番号を入力してください").max(40),
  postal_code: z.string().trim().min(1, "郵便番号を入力してください").max(20),
  prefecture: z.string().trim().min(1, "都道府県を選択してください").max(40),
  address_city: z.string().trim().min(1, "市区町村を入力してください").max(100),
  address_town: z.string().trim().min(1, "町名・番地を入力してください").max(100),
  address_building: z.string().max(200).optional().nullable(),
  birthday: z.string().trim().min(1, "生年月日を入力してください"),
  gender: z.enum(["male", "female", "other", "unspecified"], {
    errorMap: () => ({ message: "性別を選択してください" }),
  }),
  // メールマガジン・お知らせ通知は全会員へ配信のため受け取っても無視する。
  newsletter_opt_out: z.boolean().optional(),
  announcement_opt_out: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const d = parsed.data;
  // 既存カラム（full_name / address1 等）を新項目から再合成して同期する。
  const sync = buildCustomerSyncPatch(d);
  const patch: Record<string, unknown> = {
    username: d.username?.trim() ? d.username.trim() : null,
    last_name: d.last_name,
    first_name: d.first_name,
    phone: d.phone ?? null,
    postal_code: d.postal_code ?? null,
    prefecture: d.prefecture ?? null,
    address_city: d.address_city ?? null,
    address_town: d.address_town ?? null,
    address_building: d.address_building ?? null,
    gender: d.gender ?? null,
    birthday: d.birthday && d.birthday !== "" ? d.birthday : null,
    full_name: sync.full_name,
    full_name_kana: d.nickname?.trim() || null,
    address1: sync.address1,
    address2: sync.address2,
  };
  // 配信・通知は全会員が対象のため、常に受信（opt_out = false）で固定する。
  patch.newsletter_opt_out = false;
  patch.announcement_opt_out = false;

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("customers").update(patch).eq("id", session.customerId);
  if (error) {
    // ユーザーネームの一意制約違反（23505）はわかりやすいメッセージに変換。
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "このユーザーネームは既に使用されています。別のユーザーネームをご利用ください。" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 変更後の会員情報を取得し、会員本人・運営の双方へ通知する。
  // メール送信に失敗しても登録情報の変更自体は成功として扱う。
  const { data: customer } = await supabase
    .from("customers")
    .select("full_name, email")
    .eq("id", session.customerId)
    .maybeSingle();
  const memberEmail = (customer as any)?.email as string | null | undefined;
  const memberName = ((customer as any)?.full_name as string | null) ?? sync.full_name ?? null;

  if (memberEmail) {
    const memberTpl = profileUpdatedTemplate({ name: memberName });
    await notify({
      kind: "profile_updated",
      to: memberEmail,
      to_name: memberName,
      subject: memberTpl.subject,
      body_text: memberTpl.body_text,
      meta: { customer_id: session.customerId, source: "mypage_profile" },
    });
  }

  await notify({
    kind: "staff_notify",
    to: staffRecipients(),
    subject: `【登録情報の変更】${memberName ?? "会員"}`,
    body_text:
      `会員ご本人により登録情報が変更されました。\n\n` +
      `・お名前: ${memberName ?? "—"}\n` +
      `・メール: ${memberEmail ?? "—"}\n` +
      `・変更項目: ${Object.keys(patch).join(", ")}`,
    reply_to: memberEmail ?? undefined,
    meta: { customer_id: session.customerId, source: "mypage_profile" },
  });

  return NextResponse.json({ ok: true });
}
