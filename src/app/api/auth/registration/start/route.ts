import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notify, registrationVerifyTemplate } from "@/lib/notify";
import { getBaseUrl } from "@/lib/site";
import {
  generateRegistrationToken,
  REGISTRATION_TOKEN_TTL_MS,
  emailLocalPart,
} from "@/lib/registration";

// 2段階会員登録の Step1（仮登録）。
//   1. メール＋パスワードを受け取り、未確認の auth ユーザーと customers stub を作成
//   2. 確認トークンを発行し、アカウント作成ページへのリンクをメール送信
// 本登録（プロフィール入力）が完了するまではメール未確認 = ログイン不可。

const schema = z.object({
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

/**
 * 既存の auth ユーザーの id をメールアドレスから解決する。
 * createUser が重複で失敗した際の復旧（既存ユーザーの再利用）に使う。
 * listUsers にはサーバー側のメール絞り込みが無いためページングで探索する。
 */
async function findAuthUserIdByEmail(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < perPage) break; // 最終ページ
  }
  return null;
}

/** Supabase の「メール重複」系エラーかどうかを堅牢に判定する。 */
function isDuplicateAuthError(err: unknown): boolean {
  const e = err as { code?: string; status?: number; message?: string } | null;
  const msg = (e?.message ?? "").toLowerCase();
  return (
    e?.code === "email_exists" ||
    e?.status === 422 ||
    msg.includes("already been registered") ||
    msg.includes("already registered") ||
    msg.includes("already exists") ||
    msg.includes("email_exists") ||
    msg.includes("user already")
  );
}

async function uploadAvatar(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  authUserId: string,
  avatarFile: File,
): Promise<string | null> {
  if (avatarFile.size > MAX_AVATAR_BYTES) return null;
  if (!ALLOWED_AVATAR_TYPES.has(avatarFile.type)) return null;

  const ext = avatarFile.name.includes(".")
    ? avatarFile.name.slice(avatarFile.name.lastIndexOf(".") + 1).toLowerCase()
    : avatarFile.type.split("/")[1] ?? "jpg";
  const path = `${authUserId}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await avatarFile.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from("avatars")
    .upload(path, buffer, { contentType: avatarFile.type, upsert: true });
  if (upErr) return null;

  const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
  return pub.publicUrl;
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let payload: { email?: string; password?: string };
  let avatarFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    payload = {
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

  // 既存の会員データを確認する。
  const { data: existing } = await admin
    .from("customers")
    .select("id, auth_user_id, registration_completed")
    .eq("email", email)
    .maybeSingle();
  const existingRow = existing as
    | { id: string; auth_user_id: string | null; registration_completed: boolean | null }
    | null;

  // 既にログイン手段（auth ユーザー）を持ち、本登録も完了している会員は二重登録不可。
  // ※ 管理画面で手動作成された会員（auth_user_id 未連携）は、ここでログイン手段を
  //   得られるよう登録を継続させる。
  if (existingRow && existingRow.auth_user_id && existingRow.registration_completed) {
    return NextResponse.json(
      {
        error:
          "このメールアドレスは既に登録されています。ログインするか、別のメールアドレスでご登録ください。",
      },
      { status: 409 },
    );
  }

  // auth ユーザーを用意する（未完了の再登録なら既存ユーザーのパスワードを更新）。
  let authUserId: string | null = existingRow?.auth_user_id ?? null;

  if (authUserId) {
    const { error: updErr } = await admin.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: false,
      user_metadata: { full_name: emailLocalPart(email) },
    });
    if (updErr) {
      console.error("[registration/start] updateUser failed", {
        code: (updErr as { code?: string }).code,
        message: updErr.message,
      });
      return NextResponse.json(
        { error: "仮登録の処理に失敗しました。時間をおいて再度お試しください。" },
        { status: 500 },
      );
    }
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { full_name: emailLocalPart(email) },
    });
    if (createErr || !created.user) {
      if (isDuplicateAuthError(createErr)) {
        // auth ユーザーは既に存在するが、上のチェックで「完了済み会員」ではないと
        // 確認済み（= 過去の失敗試行などで残った未完了ユーザー）。既存ユーザーを
        // 解決して再利用し、登録を継続できるようにする（行き止まりにしない）。
        const recoveredId = await findAuthUserIdByEmail(admin, email);
        if (!recoveredId) {
          return NextResponse.json(
            {
              error:
                "このメールアドレスは既に登録されています。ログインするか、パスワードの再設定をお試しください。",
            },
            { status: 409 },
          );
        }
        const { error: rErr } = await admin.auth.admin.updateUserById(recoveredId, {
          password,
          email_confirm: false,
          user_metadata: { full_name: emailLocalPart(email) },
        });
        if (rErr) {
          console.error("[registration/start] recover updateUser failed", {
            message: rErr.message,
          });
          return NextResponse.json(
            { error: "仮登録の処理に失敗しました。時間をおいて再度お試しください。" },
            { status: 500 },
          );
        }
        authUserId = recoveredId;
      } else {
        console.error("[registration/start] createUser failed", {
          code: (createErr as { code?: string } | null)?.code,
          status: (createErr as { status?: number } | null)?.status,
          message: createErr?.message,
        });
        return NextResponse.json(
          { error: "仮登録の処理に失敗しました。時間をおいて再度お試しください。" },
          { status: 500 },
        );
      }
    } else {
      authUserId = created.user.id;
    }
  }

  let avatarUrl: string | null = null;
  if (avatarFile && authUserId) {
    avatarUrl = await uploadAvatar(admin, authUserId, avatarFile);
    if (!avatarUrl) {
      return NextResponse.json(
        { error: "プロフィール写真のアップロードに失敗しました。時間をおいて再度お試しください。" },
        { status: 500 },
      );
    }
  }

  // customers stub を用意する（NOT NULL の full_name は暫定でメールのローカル部）。
  let customerId: string;
  if (existingRow) {
    customerId = existingRow.id;
    await admin
      .from("customers")
      .update({
        auth_user_id: authUserId,
        registration_completed: false,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      })
      .eq("id", customerId);
  } else {
    const { data: createdCustomer, error: cErr } = await admin
      .from("customers")
      .insert({
        full_name: emailLocalPart(email),
        email,
        auth_user_id: authUserId,
        avatar_url: avatarUrl,
        status: "active",
        registration_completed: false,
      })
      .select("id")
      .single();
    if (cErr || !createdCustomer) {
      console.error("[registration/start] customer insert failed", cErr?.message);
      return NextResponse.json(
        { error: "仮登録の処理に失敗しました。時間をおいて再度お試しください。" },
        { status: 500 },
      );
    }
    customerId = createdCustomer.id;
  }

  // profiles を member ロールで紐付け。
  if (authUserId) {
    await admin.from("profiles").upsert({
      id: authUserId,
      role: "member",
      customer_id: customerId,
    });
  }

  // 既存の未使用トークンは無効化（複数の有効リンクが残らないように）。
  await admin
    .from("registration_tokens")
    .delete()
    .eq("email", email)
    .is("used_at", null);

  // 新しい確認トークンを発行。
  const token = generateRegistrationToken();
  const expiresAt = new Date(Date.now() + REGISTRATION_TOKEN_TTL_MS).toISOString();
  const { error: tErr } = await admin.from("registration_tokens").insert({
    token,
    customer_id: customerId,
    email,
    expires_at: expiresAt,
  });
  if (tErr) {
    console.error("[registration/start] token insert failed", tErr.message);
    return NextResponse.json(
      { error: "仮登録の処理に失敗しました。時間をおいて再度お試しください。" },
      { status: 500 },
    );
  }

  // 確認メールを送信。
  const url = `${getBaseUrl(req)}/signup/account?token=${encodeURIComponent(token)}`;
  const tpl = registrationVerifyTemplate({ url });
  await notify({
    kind: "registration_verify",
    to: email,
    subject: tpl.subject,
    body_text: tpl.body_text,
    meta: { customer_id: customerId, source: "registration_start" },
  });

  return NextResponse.json({ ok: true, email });
}
