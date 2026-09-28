/**
 * 会員向けメッセージ（メール）の配信ワーカー。VPS 上で配信を最後まで送り切る。
 *
 * 背景（2026-09-28 の「244/1173 で止まった」件）:
 *   一斉配信は 1 回の処理で約 45 秒ぶんだけ送り、残りは「管理画面を開いている間の自動継続」か
 *   「定期実行（/api/cron/newsletters）」で続きを送る設計。定期実行は Vercel Cron 前提のため、
 *   VPS では誰も呼ばず、管理画面を閉じた時点で配信が止まっていた。
 *   このスクリプトをタスク スケジューラから定期的に実行して、画面を閉じても確実に送り切る。
 *
 * 対象（/api/cron/newsletters と同じ）:
 *   - 予約時刻を過ぎた配信（status = scheduled）
 *   - 配信中の続き（status = sending）
 *   - 配信済み（sent）だが未送信（pending）が残っているもの
 * 同じ会員への二重送信は、送信前に 1 件ずつ「先取り」する既存の仕組み（sendMemberMessage）で防がれる。
 * 管理画面や別のワーカーと同時に動いても安全。
 *
 * 使い方（プロジェクト直下で）:
 *   npx tsx scripts/newsletter-worker.ts                 … 送るものが無くなるまで（最大 --minutes 分）送る
 *   npx tsx scripts/newsletter-worker.ts --minutes=4     … 実行時間の上限（既定 4 分。定期実行の間隔より短くする）
 *   npx tsx scripts/newsletter-worker.ts --dry-run       … 送信対象の件数を表示するだけ
 *
 * メール内のリンク・開封確認の URL は NEWSLETTER_BASE_URL（未設定なら https://retouch.salon）を使う
 * （.env.local の NEXT_PUBLIC_SITE_URL は開発用の localhost のため）。
 */
import { config } from "dotenv";
import { appendFileSync, mkdirSync } from "node:fs";
import { mkdir, open, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const MINUTES = Math.max(0.5, Number(args.find((a) => a.startsWith("--minutes="))?.split("=")[1] ?? 4) || 4);
const BASE_URL = (process.env.NEWSLETTER_BASE_URL?.trim() || "https://retouch.salon").replace(/\/+$/, "");
const LOCK = path.join(process.cwd(), "logs", "newsletter-worker.lock");

const LOG_FILE = path.join(process.cwd(), "logs", "newsletter-worker.log");

/** 画面とログファイルの両方に出す（1 行ずつ開いて閉じるので、同時に動いても書き込める） */
function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch {
    // ログを書けなくても配信は続ける
  }
}

/** 同時に 2 つ動かない（前回の実行がまだ続いていれば何もしない）。古いロックは 15 分で無効。 */
async function acquireLock(): Promise<boolean> {
  await mkdir(path.dirname(LOCK), { recursive: true });
  try {
    const s = await stat(LOCK);
    if (Date.now() - s.mtimeMs < 15 * 60 * 1000) return false;
    await rm(LOCK, { force: true });
  } catch {
    // ロックなし
  }
  try {
    const fh = await open(LOCK, "wx");
    await fh.writeFile(String(process.pid));
    await fh.close();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { createSupabaseAdminClient } = await import("../src/lib/supabase/admin");
  const { sendMemberMessage, isTemporaryRecipientError, RETRY_PREFIX_RE, MAX_AUTO_RETRIES } = await import(
    "../src/lib/memberMessages"
  );
  const admin = createSupabaseAdminClient();

  const findTargets = async (): Promise<{ id: string; title: string; pending: number }[]> => {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await admin
      .from("member_messages")
      .select("id, title, status, scheduled_at")
      .or(`and(status.eq.scheduled,scheduled_at.lte.${nowIso}),status.eq.sending`)
      .order("scheduled_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(`配信の取得に失敗しました: ${error.message}`);
    const list = [...(due ?? [])] as { id: string; title: string; status: string }[];
    const { data: recentSent } = await admin
      .from("member_messages")
      .select("id, title, status")
      .eq("status", "sent")
      .eq("channel_email", true)
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(20);
    list.push(...((recentSent ?? []) as { id: string; title: string; status: string }[]));

    const out: { id: string; title: string; pending: number }[] = [];
    for (const m of list) {
      if (out.some((o) => o.id === m.id)) continue;
      const { count } = await admin
        .from("member_message_recipients")
        .select("id", { count: "exact", head: true })
        .eq("message_id", m.id)
        .eq("email_status", "pending");
      // 予約配信の開始直後は、まだ配信先が作られていない（pending 0）ことがあるので対象に含める
      if ((count ?? 0) > 0 || m.status === "scheduled") out.push({ id: m.id, title: m.title, pending: count ?? 0 });
    }
    return out;
  };

  // 一時的なエラー（相手側サーバーの一時拒否 4xx など）で失敗した宛先を、時間をおいて自動で再送に戻す。
  // 対象は作成から 7 日以内の配信。n 回目の再送は前回から n×20 分以上あけ、最大 MAX_AUTO_RETRIES 回まで。
  const requeueTemporaryFailures = async (): Promise<number> => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: msgs } = await admin
      .from("member_messages")
      .select("id")
      .eq("channel_email", true)
      .neq("status", "canceled")
      .gte("created_at", since);
    let requeued = 0;
    for (const m of (msgs ?? []) as { id: string }[]) {
      const { data: failed } = await admin
        .from("member_message_recipients")
        .select("id, error")
        .eq("message_id", m.id)
        .eq("email_status", "failed")
        .limit(1000);
      for (const f of (failed ?? []) as { id: string; error: string | null }[]) {
        if (!isTemporaryRecipientError(f.error)) continue;
        const mark = String(f.error ?? "").match(RETRY_PREFIX_RE);
        const n = mark ? Number(mark[1]) : 0;
        if (n >= MAX_AUTO_RETRIES) continue;
        const last = mark?.[2] ? Date.parse(mark[2]) : 0;
        if (last && Date.now() - last < (n + 1) * 20 * 60 * 1000) continue;
        const original = String(f.error ?? "").replace(RETRY_PREFIX_RE, "");
        const { data: upd } = await admin
          .from("member_message_recipients")
          .update({ email_status: "pending", error: `[再送${n + 1}回目 ${new Date().toISOString()}] ${original}` })
          .eq("id", f.id)
          .eq("email_status", "failed")
          .select("id");
        requeued += upd?.length ?? 0;
      }
    }
    return requeued;
  };
  if (!DRY) {
    const requeued = await requeueTemporaryFailures();
    if (requeued > 0) log(`一時的なエラーで失敗した ${requeued} 件を自動再送の対象に戻しました。`);
  }

  const targets = await findTargets();
  if (targets.length === 0) {
    log("送信待ちの配信はありません。");
    return;
  }
  for (const t of targets) log(`対象: ${t.title}（未送信 ${t.pending} 件）`);
  if (DRY) return;

  if (!(await acquireLock())) {
    log("前回のワーカーが実行中のため、今回は何もしません。");
    return;
  }
  const deadline = Date.now() + MINUTES * 60 * 1000;
  try {
    for (const t of targets) {
      for (;;) {
        const left = deadline - Date.now();
        if (left < 10_000) {
          log("実行時間の上限に達しました。残りは次回の実行で送ります。");
          return;
        }
        // 実行中であることを示すため、ロックの更新日時を進める（15 分更新が無いロックは無効とみなす）
        await utimes(LOCK, new Date(), new Date()).catch(() => undefined);
        const r = await sendMemberMessage(admin as any, t.id, { baseUrl: BASE_URL, budgetMs: Math.min(left - 5_000, 45_000) });
        log(`${t.title}: 今回 ${r.sentCount} 件目まで送信済み・残り ${r.remaining} 件（${r.status}）`);
        if (r.throttled) {
          log(`送信制限のため中断しました（${r.throttleReason ?? "理由不明"}）。次回の実行で再開します。`);
          return;
        }
        if (!r.ok || r.remaining <= 0) break;
      }
    }
    log("送信待ちの配信をすべて送りました。");
  } finally {
    await rm(LOCK, { force: true });
  }
}

main().catch((e) => {
  log(`エラー: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
