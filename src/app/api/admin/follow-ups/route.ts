import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { cleanFollowReasons, type FollowMark } from "@/lib/followUp";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  customerId: z.string().uuid(),
  // done = 済、dismissed = 削除、open = 未対応に戻す
  state: z.enum(["done", "dismissed", "open"]),
  // 印をつけたときに画面に出ていた理由。あとで理由が加わったら、未対応に戻すために残す。
  reasons: z.array(z.string()).max(20).default([]),
});

/** 要フォローの一覧に「済」「削除」の印をつける・外す。顧客や契約のデータは変えない。 */
export async function POST(req: Request) {
  const session = await requireCapability("payments.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "指定を確認してください。" }, { status: 400 });
  }
  const { customerId, state } = parsed.data;
  const reasons = cleanFollowReasons(parsed.data.reasons);
  if (state !== "open" && reasons.length === 0) {
    return NextResponse.json({ error: "理由が読み取れませんでした。ページを開き直してからお試しください。" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: customer, error: customerError } = await admin.from("customers").select("id").eq("id", customerId).maybeSingle();
  if (customerError) return NextResponse.json({ error: "保存に失敗しました。" }, { status: 500 });
  if (!customer) return NextResponse.json({ error: "顧客が見つかりません。" }, { status: 404 });

  // 印は監査ログに 1件ずつ残す。顧客ごとに、いちばん新しい記録がいまの印（src/lib/followUpData.ts）。
  const { data, error } = await admin
    .from("audit_logs")
    .insert({
      actor_id: session.userId,
      action: `followup.${state}`,
      target_table: "customers",
      target_id: customerId,
      meta: { reasons },
    })
    .select("created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "保存に失敗しました。" }, { status: 500 });

  const mark: FollowMark | null = state === "open" ? null : { customerId, state, at: data.created_at, reasons };
  return NextResponse.json({ ok: true, mark });
}
