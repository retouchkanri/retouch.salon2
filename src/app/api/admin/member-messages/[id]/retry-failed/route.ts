import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { recomputeCounts } from "@/lib/memberMessages";

/**
 * 送信失敗（email_status='failed'）の受信者を pending に戻し、メッセージを
 * 再配信可能な状態（status='sending'）にする。実際の送信はこの後に
 * /send（管理画面の自動継続）または cron が行う。何度実行しても冪等。
 *
 * 2026-08-03 の Gmail レート制限障害で 527 件が failed のまま「配信済」に
 * なった。failed は従来リトライ経路が無い終端状態だったため、その復旧手段。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("messages.manage");
  const admin = createSupabaseAdminClient();

  const { data: message } = await admin
    .from("member_messages")
    .select("id, status, channel_email")
    .eq("id", params.id)
    .maybeSingle();
  if (!message) {
    return NextResponse.json({ error: "配信が見つかりません" }, { status: 404 });
  }
  if ((message as any).status === "draft" || (message as any).status === "canceled") {
    return NextResponse.json({ error: "この状態の配信は再送できません" }, { status: 409 });
  }

  // PostgREST は返却行数を1000で打ち切るため、件数は先に head-count で取り、
  // update は representation を返さずに実行する。
  const { count: failedBefore } = await admin
    .from("member_message_recipients")
    .select("id", { count: "exact", head: true })
    .eq("message_id", params.id)
    .eq("email_status", "failed");
  const { error } = await admin
    .from("member_message_recipients")
    .update({ email_status: "pending", error: null, sent_at: null })
    .eq("message_id", params.id)
    .eq("email_status", "failed");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const resetCount = failedBefore ?? 0;

  // ここで status は変更しない。'sent' のまま /send を呼べば sendMemberMessage が
  // pending 分を送り、'sent' を維持する（会員向けお知らせは status='sent' のみ
  // 表示されるため、'sending' に戻すと再送のあいだお知らせが全会員から消える）。

  // カウント再取得は付随情報。失敗してもリセット自体は完了しているので 500 にしない
  // （pending が不明な場合は reset 件数を下限として返す）。
  let pending = resetCount;
  let countsMeta: Record<string, number> = {};
  try {
    const counts = await recomputeCounts(admin, params.id);
    pending = counts.pending;
    countsMeta = counts;
  } catch {
    // ignore: 監査ログには reset 件数だけ残す
  }
  await writeAudit({
    actorId: session.userId,
    action: "message.retry_failed",
    targetTable: "member_messages",
    targetId: params.id,
    meta: { reset: resetCount, ...countsMeta },
  });

  return NextResponse.json({ ok: true, reset: resetCount, pending });
}
