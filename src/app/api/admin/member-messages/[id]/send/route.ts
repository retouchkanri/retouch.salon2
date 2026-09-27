import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getBaseUrl } from "@/lib/site";
import { sendMemberMessage } from "@/lib/memberMessages";

export const maxDuration = 60;
// 送信元IPを日本国内に固定する。Xserver の国外IPアクセス制限は、SMTP 認証に
// 成功していても国外IPからの RCPT TO を "554 5.7.1 Client host rejected" で拒否する
// （2026-08-09 の全件配信失敗の原因）。vercel.json の regions と必ず揃えること。
export const preferredRegion = "hnd1";

/**
 * 即時配信（または配信中の続きを送る）。大量送信時は 1 呼び出しで送り切れず
 * status='sending' のまま返ることがある。その場合は再度呼び出すか、cron が続きを送る。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("messages.manage");
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from("member_messages")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "配信が見つかりません" }, { status: 404 });
  }
  // 「配信済」でも未送信（pending）が残っていれば sendMemberMessage が続きを送る
  // （失敗分再送の途中経過など）。残っていなければ何も送らず現状を返すだけなので、
  // ここでは 409 にしない。

  const result = await sendMemberMessage(admin, params.id, { baseUrl: getBaseUrl(req) });

  await writeAudit({
    actorId: session.userId,
    action: "message.send",
    targetTable: "member_messages",
    targetId: params.id,
    meta: result,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "配信に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result });
}
