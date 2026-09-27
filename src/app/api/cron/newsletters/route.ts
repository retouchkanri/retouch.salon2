import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getBaseUrl } from "@/lib/site";
import { sendMemberMessage } from "@/lib/memberMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 大量送信に備え関数の実行時間を延長（Vercel Pro 以上で有効。Hobby は上限で頭打ち）。
export const maxDuration = 60;
// 送信元IPを日本国内に固定する。Xserver の国外IPアクセス制限は、SMTP 認証に
// 成功していても国外IPからの RCPT TO を "554 5.7.1 Client host rejected" で拒否する
// （2026-08-09 の全件配信失敗の原因）。vercel.json の regions と必ず揃えること。
export const preferredRegion = "hnd1";

/**
 * スケジュール配信のドレイン。Vercel Cron（x-vercel-cron ヘッダ）または
 * CRON_SECRET 付きの外部スケジューラから定期的に叩かれる想定。
 *   - status='scheduled' かつ scheduled_at <= now → 配信開始
 *   - status='sending'（前回送り切れなかった分）→ 続きを送信
 * 1 メッセージあたりは時間/件数バジェット内で送信し、残りは次回に持ち越す。
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron からの呼び出しは x-vercel-cron ヘッダを含む
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = new URL(req.url).searchParams.get("secret");
  return q === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  // maxDuration=60 のなかで安全に返せるよう、全体の締め切りを決めて配分する。
  const deadline = Date.now() + 50_000;

  // 予約到来済み + 配信中の続き。古い順に処理。
  const { data: due, error: dueError } = await admin
    .from("member_messages")
    .select("id, status, scheduled_at")
    .or(`and(status.eq.scheduled,scheduled_at.lte.${nowIso}),status.eq.sending`)
    .order("scheduled_at", { ascending: true })
    .limit(10);
  if (dueError) {
    // 以前はここでエラーを握りつぶして {ok:true, processed:0} を返しており、
    // cron が毎日空振りしても誰も気付けなかった。明示的に失敗させて監視に乗せる。
    console.error("[cron/newsletters] selection query failed:", dueError.message);
    return NextResponse.json({ ok: false, error: dueError.message }, { status: 500 });
  }

  // 「配信済（status='sent'）だが未送信（pending）が残っている」メッセージも拾う。
  // 失敗分の再送や、再送中のレート制限中断はお知らせ表示を守るため status を
  // 'sent' のまま進める設計なので、status だけ見ていると永久に再開されない。
  // 直近の配信済みメールに限って pending を確認する（1件ずつの head-count なので軽い）。
  const targets = [...(due ?? [])];
  const { data: recentSent } = await admin
    .from("member_messages")
    .select("id, status, scheduled_at")
    .eq("status", "sent")
    .eq("channel_email", true)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(20);
  for (const m of recentSent ?? []) {
    const { count: pend } = await admin
      .from("member_message_recipients")
      .select("id", { count: "exact", head: true })
      .eq("message_id", (m as any).id)
      .eq("email_status", "pending");
    if ((pend ?? 0) > 0) targets.push(m);
  }

  const baseUrl = getBaseUrl(req);
  const results: Array<{ id: string; status: string; sent: number; remaining: number; error?: string }> = [];
  for (const m of targets) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 5_000) break; // 残り時間がなければ次回の cron に持ち越す
    try {
      const r = await sendMemberMessage(admin, (m as any).id, { baseUrl, budgetMs: remainingMs });
      results.push({ id: (m as any).id, status: r.status, sent: r.sentCount, remaining: r.remaining });
      // レート制限を検知したら、このcron実行では以降のメッセージも送らない
      // （同じトランスポートで失敗を積み増すだけのため）。
      if (r.throttled) break;
    } catch (e: any) {
      // 1メッセージの異常（不正データ等）で他のメッセージの配信まで止めない。
      console.error("[cron/newsletters] send failed for", (m as any).id, e?.message ?? e);
      results.push({ id: (m as any).id, status: "error", sent: 0, remaining: 0, error: e?.message ?? "unknown" });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
