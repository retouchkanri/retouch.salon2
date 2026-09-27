import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { ROLES, canManageRole } from "@/lib/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  full_name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES).default("member"),
});

export async function POST(req: Request) {
  const session = await requireCapability("users.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const { email, password, full_name, role } = parsed.data;

  // An admin cannot create owner/admin accounts; only an owner can.
  if (!canManageRole(session.role, role)) {
    return NextResponse.json(
      { error: "この権限を付与する権限がありません。" },
      { status: 403 },
    );
  }
  const admin = createSupabaseAdminClient();

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (userErr || !userData.user) {
    return NextResponse.json(
      {
        error: userErr?.message.includes("already registered")
          ? "このメールは登録済みです"
          : "登録に失敗しました",
      },
      { status: 400 },
    );
  }

  const { data: created, error: cErr } = await admin
    .from("customers")
    .insert({
      full_name,
      email,
      auth_user_id: userData.user.id,
      status: "active",
    })
    .select("id")
    .single();
  if (cErr || !created) {
    return NextResponse.json({ error: "会員データ作成に失敗しました" }, { status: 500 });
  }

  await admin
    .from("profiles")
    .upsert({ id: userData.user.id, role, customer_id: created.id });

  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "user.create",
    target_table: "auth.users",
    target_id: userData.user.id,
    meta: { role },
  });

  return NextResponse.json({ ok: true, id: userData.user.id });
}
