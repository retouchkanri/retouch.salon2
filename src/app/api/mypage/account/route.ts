import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  email: z.string().email("メールアドレスの形式が正しくありません").optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8, "パスワードは8文字以上で設定してください").optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { email, newPassword } = parsed.data;
  if (!email && !newPassword) {
    return NextResponse.json({ error: "変更内容がありません" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const authUpdate: Record<string, string> = {};

  if (email && email !== session.email) {
    authUpdate.email = email;
  }
  if (newPassword) {
    authUpdate.password = newPassword;
  }

  if (Object.keys(authUpdate).length > 0) {
    const { error } = await admin.auth.admin.updateUserById(session.userId, authUpdate);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  if (email && email !== session.email && session.customerId) {
    await admin.from("customers").update({ email }).eq("id", session.customerId);
  }

  return NextResponse.json({ ok: true });
}
