import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  notify,
  memberWelcomeTemplate,
  staffRecipients,
} from "@/lib/notify";
import { buildCustomerSyncPatch } from "@/lib/registration";

// 2段階会員登録の Step2（本登録）。確認トークンを検証し、詳細プロフィールを
// customers に保存して auth ユーザーを確認済みに昇格（= ログイン解禁）する。

const schema = z.object({
  token: z.string().min(1),
  username: z.string().trim().min(1, "ユーザーネームを入力してください").max(60),
  last_name: z.string().trim().min(1, "姓を入力してください").max(60),
  first_name: z.string().trim().min(1, "名を入力してください").max(60),
  nickname: z.string().trim().max(60).optional(),
  phone: z.string().trim().min(1, "電話番号を入力してください").max(40),
  postal_code: z.string().trim().min(1, "郵便番号を入力してください").max(20),
  prefecture: z.string().trim().min(1, "都道府県を入力してください").max(40),
  address_city: z.string().trim().min(1, "市区町村を入力してください").max(100),
  address_town: z.string().trim().min(1, "町名・番地を入力してください").max(100),
  address_building: z.string().trim().max(200).optional().nullable(),
  gender: z.enum(["male", "female", "other", "unspecified"], {
    errorMap: () => ({ message: "性別を選択してください" }),
  }),
  birthday: z.string().trim().min(1, "生年月日を入力してください"),
  // メールマガジン・お知らせ通知は全会員へ配信のため受け取っても無視する。
  newsletter_opt_out: z.boolean().optional(),
  announcement_opt_out: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力に誤りがあります" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const admin = createSupabaseAdminClient();

  // トークン検証（未使用・未期限切れ）。
  const { data: tokenRow } = await admin
    .from("registration_tokens")
    .select("id, customer_id, email, used_at, expires_at")
    .eq("token", data.token)
    .maybeSingle();

  const tk = tokenRow as
    | { id: string; customer_id: string | null; email: string; used_at: string | null; expires_at: string }
    | null;
  if (!tk || tk.used_at || new Date(tk.expires_at).getTime() < Date.now() || !tk.customer_id) {
    return NextResponse.json(
      { error: "リンクが無効か、有効期限が切れています。お手数ですが最初からやり直してください。" },
      { status: 400 },
    );
  }
  const customerId = tk.customer_id;

  // ユーザーネームの重複チェック（自分自身は除外）。
  const { data: dupUser } = await admin
    .from("customers")
    .select("id")
    .ilike("username", data.username)
    .neq("id", customerId)
    .maybeSingle();
  if (dupUser) {
    return NextResponse.json(
      { error: "このユーザーネームは既に使用されています。別のユーザーネームをご利用ください。" },
      { status: 409 },
    );
  }

  // 既存カラム（full_name 等）への合成値を組み立てる。
  const sync = buildCustomerSyncPatch(data);
  const birthday = data.birthday;

  const { error: upErr } = await admin
    .from("customers")
    .update({
      username: data.username,
      last_name: data.last_name,
      first_name: data.first_name,
      phone: data.phone,
      postal_code: data.postal_code,
      prefecture: data.prefecture,
      address_city: data.address_city,
      address_town: data.address_town,
      address_building: data.address_building ?? null,
      gender: data.gender,
      birthday,
      newsletter_opt_out: false,
      announcement_opt_out: false,
      // 後方互換のため合成カラムも同期。full_name_kana はニックネーム項目。
      full_name: sync.full_name,
      full_name_kana: data.nickname?.trim() || null,
      address1: sync.address1,
      address2: sync.address2,
      registration_completed: true,
      joined_at: new Date().toISOString(),
    })
    .eq("id", customerId);
  if (upErr) {
    console.error("[registration/complete] customer update failed", upErr.message);
    return NextResponse.json(
      { error: "登録の保存に失敗しました。時間をおいて再度お試しください。" },
      { status: 500 },
    );
  }

  // auth ユーザーを確認済みに昇格（= メール＋パスワードでログイン可能になる）。
  const { data: cust } = await admin
    .from("customers")
    .select("auth_user_id, email")
    .eq("id", customerId)
    .maybeSingle();
  const authUserId = (cust as { auth_user_id?: string | null } | null)?.auth_user_id ?? null;
  if (authUserId) {
    const { error: confErr } = await admin.auth.admin.updateUserById(authUserId, {
      email_confirm: true,
      user_metadata: { full_name: sync.full_name },
    });
    if (confErr) {
      console.error("[registration/complete] confirm user failed", confErr.message);
      return NextResponse.json(
        { error: "アカウントの有効化に失敗しました。お手数ですが運営までお問い合わせください。" },
        { status: 500 },
      );
    }
  }

  // トークンを使用済みにする。
  await admin
    .from("registration_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", tk.id);

  // ウェルカムメール（会員本人）＋スタッフ通知。送信失敗は登録成功に影響させない。
  const memberEmail = (cust as { email?: string | null } | null)?.email ?? tk.email;
  const welcome = memberWelcomeTemplate({ name: sync.full_name });
  await notify({
    kind: "member_welcome",
    to: memberEmail,
    to_name: sync.full_name,
    subject: welcome.subject,
    body_text: welcome.body_text,
    meta: { customer_id: customerId, source: "registration_complete" },
  });

  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  await notify({
    kind: "staff_notify",
    to: staffRecipients(),
    subject: `【新規会員登録】${sync.full_name}`,
    body_text:
      `新規会員登録（本登録）が完了しました。\n\n` +
      `・お名前: ${sync.full_name}\n` +
      `・ユーザーネーム: ${data.username}\n` +
      `・メール: ${memberEmail}\n` +
      `・電話: ${data.phone}\n` +
      `・登録日時: ${dateStr}`,
    reply_to: memberEmail,
    meta: { customer_id: customerId, source: "registration_complete" },
  });

  return NextResponse.json({ ok: true });
}
