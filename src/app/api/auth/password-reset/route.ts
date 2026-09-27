import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notify, passwordResetTemplate } from "@/lib/notify";

// パスワード再設定メールを「アプリ自身のSMTP」で日本語送信する。
//   - Supabase の英語デフォルトメール（resetPasswordForEmail）は使わない。
//   - admin.generateLink で recovery の hashed_token を取得し、
//     /login/reset/update?token_hash=...&type=recovery のURLを組み立てる。
//   - token_hash 方式は PKCE の verifier を必要としないため、
//     申込時と別のブラウザ／メールアプリ内ブラウザで開いても再設定できる。
// アカウントの有無を外部に漏らさないよう、結果は常に { ok: true } を返す。

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "メールアドレスを正しく入力してください。" },
      { status: 400 },
    );
  }
  const email = parsed.data.email.trim().toLowerCase();
  // リンクのベースURLは「実際にユーザーがアクセスしているドメイン」を最優先で使う。
  // （旧実装の window.location.origin と同じ挙動。env が localhost のままでも本番ドメインになる）
  const origin =
    req.headers.get("origin") ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    new URL(req.url).origin;
  const siteUrl = origin.replace(/\/+$/, "");
  const redirectTo = `${siteUrl}/login/reset/update`;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    // 未登録メール等は error になる。存在を漏らさないため、何も送らず成功扱い。
    if (error) {
      console.warn("[password-reset] generateLink failed:", error.message);
      return NextResponse.json({ ok: true });
    }

    const props = (data as any)?.properties ?? {};
    const hashedToken: string | undefined = props.hashed_token;
    if (!hashedToken) {
      console.error("[password-reset] missing hashed_token in generateLink response");
      return NextResponse.json({ ok: true });
    }

    const url =
      `${siteUrl}/login/reset/update` +
      `?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;
    const name: string | null =
      (data as any)?.user?.user_metadata?.full_name ?? null;

    const tpl = passwordResetTemplate({ name, url });
    const res = await notify({
      kind: "password_reset",
      to: email,
      to_name: name,
      subject: tpl.subject,
      body_text: tpl.body_text,
    });
    if (!res.sent) {
      // 送信失敗はユーザーに知らせて再試行を促す（存在の有無は明かさない一般的なメッセージ）。
      console.error("[password-reset] notify failed:", res.error);
      return NextResponse.json(
        { error: "メールの送信に失敗しました。時間をおいて再度お試しください。" },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[password-reset] unexpected error:", e);
    return NextResponse.json(
      { error: "処理中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 500 },
    );
  }
}
