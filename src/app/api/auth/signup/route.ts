import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { memberWelcomeTemplate, notify, staffRecipients } from "@/lib/notify";

// ⚠️ 非推奨（2026-06-22〜）: 旧・1段階サインアップAPI。
// 会員登録は「メール確認付き2段階フロー」に置き換えました：
//   Step1 /api/auth/registration/start → Step2 /api/auth/registration/complete
// 現在この route はどこからも呼ばれていません（残置のみ。将来削除可）。
//
// Public sign-up always creates a "member". Staff roles (owner/admin/moderator)
// are assigned only from the admin user-management screen — never self-elected.
// お名前は登録フォームから廃止したため任意項目。未入力時はメールのローカル部を
// 暫定の表示名にフォールバックする（顧客データ・各種通知メールが空名にならないように）。
const schema = z.object({
  fullName: z.string().trim().max(120).optional(),
  email: z.string().trim().email("メールアドレスの形式が正しくありません"),
  password: z.string().min(8, "パスワードは8文字以上で設定してください"),
});

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let payload: { fullName?: string; email?: string; password?: string };
  let avatarFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    payload = {
      fullName: String(fd.get("fullName") ?? ""),
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
    };
    const candidate = fd.get("avatar");
    if (candidate instanceof File && candidate.size > 0) avatarFile = candidate;
  } else {
    payload = await req.json().catch(() => ({}));
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力に誤りがあります" },
      { status: 400 },
    );
  }
  const { email, password } = parsed.data;
  const fullName = (parsed.data.fullName ?? "").trim() || email.split("@")[0];

  if (avatarFile) {
    if (avatarFile.size > MAX_AVATAR_BYTES) {
      return NextResponse.json(
        { error: "画像は5MB以内でアップロードしてください" },
        { status: 400 },
      );
    }
    if (!ALLOWED_AVATAR_TYPES.has(avatarFile.type)) {
      return NextResponse.json(
        { error: "画像はJPEG/PNG/WEBP/GIFのいずれかをご利用ください" },
        { status: 400 },
      );
    }
  }

  const admin = createSupabaseAdminClient();

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (userErr || !userData.user) {
    // 実エラーをサーバーログに残す（原因調査のため。メールアドレス等のPIIは出さない）。
    console.error("[signup] createUser failed", {
      code: (userErr as { code?: string } | null)?.code,
      status: (userErr as { status?: number } | null)?.status,
      message: userErr?.message,
    });
    // 重複メールの判定を堅牢化する。
    // Supabase の実メッセージは "A user with this email address has already
    // been registered"（"been" を挟む）のため、旧来の includes("already registered")
    // ではマッチせず汎用エラーになっていた。code / status / 各種文言で判定する。
    const msg = (userErr?.message ?? "").toLowerCase();
    const isDuplicate =
      (userErr as { code?: string } | null)?.code === "email_exists" ||
      (userErr as { status?: number } | null)?.status === 422 ||
      msg.includes("already been registered") ||
      msg.includes("already registered") ||
      msg.includes("already exists") ||
      msg.includes("email_exists") ||
      msg.includes("user already");
    return NextResponse.json(
      {
        error: isDuplicate
          ? "このメールアドレスは既に登録されています。ログインするか、別のメールアドレスでご登録ください。"
          : "会員登録に失敗しました。お手数ですが時間をおいて再度お試しください。",
      },
      { status: isDuplicate ? 409 : 400 },
    );
  }

  let avatarUrl: string | null = null;
  if (avatarFile) {
    const ext = avatarFile.name.includes(".")
      ? avatarFile.name.slice(avatarFile.name.lastIndexOf(".") + 1).toLowerCase()
      : avatarFile.type.split("/")[1] ?? "jpg";
    const path = `${userData.user.id}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await avatarFile.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from("avatars")
      .upload(path, buffer, { contentType: avatarFile.type, upsert: true });
    if (!upErr) {
      const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
      avatarUrl = pub.publicUrl;
    }
  }

  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  let customerId: string;
  if (existing?.id) {
    customerId = existing.id;
    await admin
      .from("customers")
      .update({
        auth_user_id: userData.user.id,
        full_name: fullName,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      })
      .eq("id", existing.id);
  } else {
    const { data: created, error: cErr } = await admin
      .from("customers")
      .insert({
        full_name: fullName,
        email,
        auth_user_id: userData.user.id,
        avatar_url: avatarUrl,
        status: "active",
      })
      .select("id")
      .single();
    if (cErr || !created) {
      return NextResponse.json({ error: "会員データ作成に失敗しました" }, { status: 500 });
    }
    customerId = created.id;
  }

  await admin.from("profiles").upsert({
    id: userData.user.id,
    role: "member",
    customer_id: customerId,
  });

  // 新規会員へのウェルカムメール
  const welcomeTpl = memberWelcomeTemplate({ name: fullName });
  await notify({
    kind: "member_welcome",
    to: email,
    to_name: fullName,
    subject: welcomeTpl.subject,
    body_text: welcomeTpl.body_text,
    meta: { customer_id: customerId },
  });

  // スタッフへの新規登録通知
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  await notify({
    kind: "staff_notify",
    to: staffRecipients(),
    subject: `【新規会員登録】${fullName}`,
    body_text:
      `新規会員登録がありました。\n\n` +
      `・お名前: ${fullName}\n` +
      `・メール: ${email}\n` +
      `・登録日時: ${dateStr}`,
    meta: { customer_id: customerId, source: "signup" },
  });

  return NextResponse.json({ ok: true });
}
