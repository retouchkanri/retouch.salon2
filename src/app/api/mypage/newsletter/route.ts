import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ opt_out: z.boolean() });

/**
 * 会員ごとのメルマガ配信設定。配信停止フラグの ON/OFF を本人が切り替える。
 * アカウント保全・配信設定のため MEMBER_SELF_SERVICE の制限対象外。
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("customers")
    .update({ newsletter_opt_out: parsed.data.opt_out })
    .eq("id", session.customerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, opt_out: parsed.data.opt_out });
}
