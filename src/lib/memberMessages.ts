import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, numEnv } from "./notify";
import { fetchAllRows } from "@/lib/fetchAll";
import type { MemberMessage } from "@/types/db";

/**
 * 会員向けメッセージ配信エンジン（お知らせ閲覧 + メルマガ）。
 *
 * - 配信対象を materialize（member_message_recipients を1会員1行で生成）
 * - メール配信（HTML + テキスト）。開封ピクセル・配信停止リンクを埋め込む
 * - 件数は無制限（配信対象は絞り込みなしで全件を materialize）。1回のHTTP呼び出し
 *   には Vercel の実行時間上限があるため、時間バジェット内で送れる分だけ送り、
 *   残りがあれば status='sending' のまま返す。管理画面はこれを検知して自動的に
 *   続きを呼び出し続けるため、管理者が手動で「配信を続ける」を押し直す必要はない
 *   （/api/admin/member-messages/[id]/send を残数が0になるまで自動で繰り返し呼ぶ）。
 *   ブラウザを閉じてしまった場合も cron（/api/cron/newsletters）が続きを送る。
 * - 冪等: recipients は unique(message_id, customer_id)。送信済みは再送しない。
 */

// Vercel の maxDuration=60 に対し十分なバッファを残して 1 呼び出しあたりの送信時間を確保。
// 60秒を超える値を設定すると関数ごと強制終了され「送信済み記録だけ残って実際は
// 未送信」の行が生まれるため、環境変数でも 45 秒を上限とする。
const SEND_TIME_BUDGET_MS = Math.min(numEnv("NEWSLETTER_TIME_BUDGET_MS", 45_000), 45_000);
// 1 呼び出しあたりの送信件数上限（時間バジェットが先に尽きるのが通常のため、実質は時間で制御される）。
// 会員数に応じて無理なく上げられるよう十分大きい値をデフォルトにしている。
const MAX_PER_CALL = numEnv("NEWSLETTER_BATCH", 100_000);
// Supabase から一度に取得する未送信件数（多いほど往復が減り高速化する）。
const FETCH_CHUNK_SIZE = numEnv("NEWSLETTER_FETCH_CHUNK", 50);
// 行を「送信済み」に先取りしてから実送信するため、残り時間がこの猶予を下回ったら
// 新しい行のクレームをやめる（送信中に関数が強制終了されると未送信のまま
// 送信済み扱いになるのを避ける）。
const CLAIM_HEADROOM_MS = 5_000;

/**
 * Gmail 無料アカウントは1日あたり約500通が上限で、超えると
 * "550 5.4.5 Daily user sending limit exceeded" で拒否される。上限ぎりぎりまで
 * 送り続けると Google の不正利用検知に引っかかりアカウント停止のリスクが
 * 上がるため、余裕をもって手前で自主的に止める（同一アカウントから送る
 * 予約確認・パスワード再設定等の業務メール分の枠も残す）。
 * Xserver 等の商用SMTP（1,500通/時・15,000通/日）に切り替えた場合はこの上限
 * 自体が意味をなさなくなるため、SMTP_HOST に応じて既定値を自動で切り替える。
 */
function defaultNewsletterDailyCap(): number {
  const host = (process.env.SMTP_HOST ?? "").toLowerCase();
  return host.includes("gmail") ? 400 : 5_000;
}
const NEWSLETTER_DAILY_CAP = numEnv("NEWSLETTER_DAILY_CAP", defaultNewsletterDailyCap());

/** 配信対象チェックボックス／APIバリデーションの共通の値一覧（単一の情報源）。 */
export const AUDIENCE_VALUES = [
  "all",
  "subset",
  "rpt_only",
  "support_only",
  "no_class",
  "class_attender",
  "class_owner",
  "class_b",
  "class_a",
  "class_c",
  "class_support",
  "team_only",
] as const;

// ---------------------------------------------------------------------------
// HTML / text rendering
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML本文からプレーンテキストの抜粋を作る（一覧のプレビュー用）。 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 配信物本文を、表示用の安全なHTML断片へ変換する。 */
export function messageBodyHtml(body: string, format: "html" | "text"): string {
  if (format === "text") return escapeHtml(body).replace(/\r?\n/g, "<br />");
  return body; // HTMLは管理者（スタッフ）が作成する信頼済みコンテンツ
}

function openPixelUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/track/open/${token}`;
}

/**
 * 本文中の裸のURL（管理者がリンク設定せずそのまま貼り付けたURL）を自動的にリンク化する。
 * リッチテキストエディタで既に <a href="..."> として設定済みのリンクはそのまま保持し、
 * その内側（アンカー要素の中）にある文字列は再リンク化しない（入れ子の <a> を防ぐ）。
 */
function autoLinkUrls(html: string): string {
  let anchorDepth = 0;
  return html.replace(/(<a\b[^>]*>|<\/a>|<[^>]*>|https?:\/\/[^\s<>"']+)/gi, (match) => {
    if (/^<a\b/i.test(match)) {
      anchorDepth++;
      return match;
    }
    if (/^<\/a>/i.test(match)) {
      anchorDepth = Math.max(0, anchorDepth - 1);
      return match;
    }
    if (match.startsWith("<")) return match;
    if (anchorDepth > 0) return match; // 既存の <a>...</a> の内側はそのまま
    return `<a href="${match}" style="color:#78716c;">${match}</a>`;
  });
}

function attachmentsHtml(imageUrls: string[], pdfUrls: string[]): string {
  const images = (imageUrls ?? []).filter(Boolean);
  const pdfs = (pdfUrls ?? []).filter(Boolean);
  if (images.length === 0 && pdfs.length === 0) return "";
  const imgHtml = images
    .map((url) => `<img src="${escapeHtml(url)}" alt="添付画像" style="display:block;width:100%;max-width:544px;margin:12px 0;border-radius:8px;" />`)
    .join("");
  const pdfHtml = pdfs.length
    ? `<div style="margin-top:12px;">${pdfs
        .map(
          (url, i) =>
            `<p style="margin:4px 0;"><a href="${escapeHtml(url)}" style="color:#0369a1;">📄 添付資料${pdfs.length > 1 ? `${i + 1}` : ""}（PDF）を開く</a></p>`,
        )
        .join("")}</div>`
    : "";
  return `${imgHtml}${pdfHtml}`;
}

/** メルマガ用の完全なHTMLメールを組み立てる（開封ピクセル・配信停止リンク込み）。 */
export function renderEmailHtml(params: {
  name: string | null;
  title: string;
  body: string;
  bodyFormat: "html" | "text";
  baseUrl: string;
  token: string;
  imageUrls?: string[];
  pdfUrls?: string[];
}): string {
  const who = (params.name?.trim() || "会員") + "様";
  const inner = autoLinkUrls(messageBodyHtml(params.body, params.bodyFormat));
  const attachments = attachmentsHtml(params.imageUrls ?? [], params.pdfUrls ?? []);
  const pixel = openPixelUrl(params.baseUrl, params.token);
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(params.title)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e5e4;">
<tr><td style="padding:24px 28px 8px;font-family:'Hiragino Kaku Gothic ProN',Meiryo,sans-serif;color:#1c1917;">
<p style="margin:0 0 16px;font-size:14px;color:#57534e;">${escapeHtml(who)}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.5;color:#1c1917;">${escapeHtml(params.title)}</h1>
<div style="font-size:15px;line-height:1.8;color:#292524;">${inner}</div>
${attachments}
</td></tr>
<tr><td style="padding:20px 28px 28px;font-family:'Hiragino Kaku Gothic ProN',Meiryo,sans-serif;">
<hr style="border:none;border-top:1px solid #e7e5e4;margin:0 0 16px;" />
<p style="margin:0;font-size:12px;color:#78716c;">Retouchメンバーズサイト 運営事務局</p>
</td></tr>
</table>
</td></tr>
</table>
<img src="${pixel}" width="1" height="1" alt="" style="display:none;border:0;" />
</body></html>`;
}

/** メールのテキストパート（HTMLを表示できないクライアント向け）。 */
export function renderEmailText(params: {
  name: string | null;
  title: string;
  body: string;
  bodyFormat: "html" | "text";
  baseUrl: string;
  token: string;
  imageUrls?: string[];
  pdfUrls?: string[];
}): string {
  const who = (params.name?.trim() || "会員") + "様";
  const bodyText = params.bodyFormat === "text" ? params.body : htmlToPlainText(params.body);
  const attachments = [...(params.imageUrls ?? []), ...(params.pdfUrls ?? [])].filter(Boolean);
  const attachmentsText = attachments.length
    ? `\n添付資料:\n${attachments.map((url) => `- ${url}`).join("\n")}\n`
    : "";
  return (
    `${who}\n\n` +
    `${params.title}\n\n` +
    `${bodyText}\n` +
    attachmentsText +
    `\n——————————————————\n` +
    `Retouchメンバーズサイト 運営事務局`
  );
}

// ---------------------------------------------------------------------------
// Audience & recipients
// ---------------------------------------------------------------------------

type AudienceCustomer = {
  id: string;
  email: string | null;
  full_name: string | null;
  newsletter_opt_out: boolean;
};

async function fetchCustomersByIds(admin: SupabaseClient, ids: string[]): Promise<AudienceCustomer[]> {
  if (ids.length === 0) return [];
  const pageSize = 500;
  const all: AudienceCustomer[] = [];
  for (let i = 0; i < ids.length; i += pageSize) {
    const { data } = await admin
      .from("customers")
      .select("id, email, full_name, newsletter_opt_out")
      .in("id", ids.slice(i, i + pageSize))
      .eq("status", "active");
    if (data) all.push(...(data as AudienceCustomer[]));
  }
  return all;
}

// 会員種別ごとの配信対象。v_customer_summary（顧客一覧の絞り込みと同一の定義）を
// customer_id だけ取得して絞り込み、fetchCustomersByIds で実データに解決する。
// アテンダー会員はメンバーズ会員(A)とコードを共有するため primary_plan_name で区別する
// （src/app/admin/(protected)/customers/page.tsx の cls フィルタと同じロジック）。
const VIEW_AUDIENCE_FILTERS: Record<string, (q: any) => any> = {
  rpt_only: (q) => q.eq("rpt_active", true),
  support_only: (q) => q.gt("total_support_horses", 0),
  // 空白の人のみ（無料会員）: 基本プランなし かつ リタポなし かつ 特別チーム(がんがん等)なし
  no_class: (q) => q.is("member_class_code", null).eq("rpt_active", false).eq("special_team_count", 0),
  class_attender: (q) => q.eq("primary_plan_name", "アテンダー会員"),
  class_a: (q) => q.eq("member_class_code", "A").neq("primary_plan_name", "アテンダー会員"),
  class_b: (q) => q.eq("member_class_code", "B"),
  class_c: (q) => q.eq("member_class_code", "C"),
  class_owner: (q) => q.eq("member_class_code", "OWNER"),
  class_support: (q) => q.eq("member_class_code", "SUPPORT"),
  team_only: (q) => q.gt("special_team_count", 0),
};

async function resolveSingleAudience(
  admin: SupabaseClient,
  audience: string,
  targetCustomerIds: string[],
): Promise<AudienceCustomer[]> {
  if (audience === "subset") {
    const ids = targetCustomerIds ?? [];
    if (ids.length === 0) return [];
    // ids が 1000 を超えても取りこぼさないよう、チャンク取得に統一する。
    return fetchCustomersByIds(admin, ids);
  }

  const viewFilter = VIEW_AUDIENCE_FILTERS[audience];
  if (viewFilter) {
    // 配信対象の抽出は取りこぼしが即「未配信」になるため、1000 行上限を越えて
    // 最後までページングする。
    const { rows } = await fetchAllRows<any>((from, to) => {
      let q = admin.from("v_customer_summary").select("customer_id").eq("status", "active");
      q = viewFilter(q);
      return q.order("customer_id", { ascending: true }).range(from, to);
    });
    const ids = rows.map((r) => r.customer_id as string);
    return fetchCustomersByIds(admin, ids);
  }

  // 'all'（または未知の値のフォールバック）→ 全アクティブ会員（1000件上限を超える場合に備えページング）
  const all: AudienceCustomer[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await admin
      .from("customers")
      .select("id, email, full_name, newsletter_opt_out")
      .eq("status", "active")
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as AudienceCustomer[]));
    if (data.length < pageSize) break;
  }
  return all;
}

async function resolveAudienceCustomers(
  admin: SupabaseClient,
  msg: MemberMessage,
): Promise<AudienceCustomer[]> {
  // 複数選択（audiences）を優先。空なら旧単一値（audience）にフォールバック
  // （移行前の履歴メッセージ用）。
  const audienceList =
    msg.audiences && msg.audiences.length > 0 ? msg.audiences : [msg.audience];

  // 「全アクティブ会員」がどれか1つでも含まれていれば、他の選択に関わらず全員が対象。
  if (audienceList.includes("all")) {
    return resolveSingleAudience(admin, "all", []);
  }

  const merged = new Map<string, AudienceCustomer>();
  for (const audience of audienceList) {
    const customers = await resolveSingleAudience(admin, audience, msg.target_customer_ids);
    for (const c of customers) merged.set(c.id, c);
  }
  return Array.from(merged.values());
}

export async function recomputeCounts(admin: SupabaseClient, messageId: string) {
  const base = () =>
    admin
      .from("member_message_recipients")
      .select("id", { count: "exact", head: true })
      .eq("message_id", messageId);
  const [totalQ, sentQ, pendingQ, failedQ, skippedQ] = await Promise.all([
    base(),
    base().eq("email_status", "sent"),
    base().eq("email_status", "pending"),
    base().eq("email_status", "failed"),
    base().eq("email_status", "skipped"),
  ]);
  // カウント取得の失敗を 0 と解釈してはならない。pending=0 と誤認すると
  // 未送信を大量に残したまま status='sent' で確定してしまう。
  const err = totalQ.error ?? sentQ.error ?? pendingQ.error ?? failedQ.error ?? skippedQ.error;
  if (err) throw new Error(`recipient counts unavailable: ${err.message}`);
  return {
    total: totalQ.count ?? 0,
    sent: sentQ.count ?? 0,
    pending: pendingQ.count ?? 0,
    failed: failedQ.count ?? 0,
    skipped: skippedQ.count ?? 0,
  };
}

/**
 * 「サーバ／設定全体に波及する障害」（このまま続けても以降の全受信者が同じ理由で
 * 失敗するもの）か判定する。該当したら受信者を failed（終端状態）にせず pending の
 * まま残して送信を中断し、cron / 再実行に委ねる。
 *
 * 2026-08-03 の障害では Gmail の 454-4.7.0（ログイン回数制限）が1件出た時点で
 * 以降の527件も全て同じ失敗になることが確定していたのに、全件を failed で
 * 焼き払ってしまった。この判定がその再発を防ぐ。
 *
 * 対象はあくまで基盤側の障害のみ:
 *   - 認証まわり（パスワード誤り含む。誤設定のままログイン試行を重ねると制限が悪化する）
 *   - レート制限・日次上限・一時抑制
 *   - ネットワーク・DNS・タイムアウト
 *   - トランスポート未設定
 * 宛先固有のエラー（アドレス不正・メールボックス満杯等）は従来どおり failed とし、
 * 管理画面の「失敗分を再送」で個別にリトライできる。
 */
export function isInfrastructureSendError(error: string | null | undefined): boolean {
  if (!error) return false;
  // --- 宛先固有の失敗（その受信者だけの問題）を先に確定させる ---------------
  // 基盤エラー扱いにすると order-by-id で毎回同じ行が先頭に来て配信全体が
  // 永久に止まる「毒薬行」になるため、必ず failed（個別再送）に落とす。
  // 受信者ごとの拒否は 554/5.7.1 など基盤エラーと同じコードを返すことがあるため、
  // 下の基盤エラー判定より前に評価する。
  if (/5\.2\.2|over quota|quota exceeded|mailbox (is )?full/i.test(error)) return false;
  if (
    /recipient address rejected|user unknown|no such (user|recipient)|unknown user|5\.1\.1|address not found|does not exist/i.test(
      error,
    )
  ) {
    return false;
  }
  // --- 基盤側の障害（続行しても以降の全受信者が同じ理由で失敗する） ---------
  // 送信元ホスト自体の拒否（例: Xserver の国外IPアクセス制限が Vercel の
  // AWS us-east-1 を弾く「554 5.7.1 ...: Client host rejected: Access denied」）は
  // 受信者に依存しない。宛先固有の失敗として焼き払うと、設定を直しても
  // 復旧に「失敗分を再送」が必要になり、1回の配信で全会員を失う。
  if (
    /client host rejected|relay(ing)? (access )?denied|sender address rejected|not authori[sz]ed to (send|relay)|blocked using|listed (in|by)|spamhaus|blacklist/i.test(
      error,
    )
  ) {
    return true;
  }
  return (
    /invalid login|too many login|username and password not accepted|authentication|try again later|rate ?limit|too many (connections|messages)|daily user sending limit|5\.4\.5|sending quota|timeout|timed ?out|ETIMEDOUT|ESOCKET|ECONN|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|greeting never received|socket (close|hang ?up)|connection (closed|refused|reset|lost)|not configured|no transport/i.test(
      error,
    )
  );
}

/**
 * 直近24時間に送信したメルマガ通数（全配信メッセージ横断・現在配信中のものに限らない）。
 * Gmail 等の送信上限はキャンペーン単位ではなくアカウント単位のため、合算する必要がある。
 */
async function countRecentBulkSends(
  admin: SupabaseClient,
): Promise<{ count: number; error: string | null }> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await admin
    .from("member_message_recipients")
    .select("id", { count: "exact", head: true })
    .eq("email_status", "sent")
    .gte("sent_at", since);
  return { count: count ?? 0, error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Send orchestration
// ---------------------------------------------------------------------------

export type SendResult = {
  ok: boolean;
  status: string;
  recipientCount: number;
  sentCount: number;
  remaining: number;
  failedCount?: number;
  /** プロバイダのレート制限等を検知して中断した場合 true。呼び出し側は連打せず cron に委ねる。 */
  throttled?: boolean;
  throttleReason?: string;
  error?: string;
};

/**
 * メッセージを配信する。メール未送信が残れば status='sending' のまま返し、
 * cron / 再実行で続きを送る。in-app のみ（メールなし）の場合は即 'sent'。
 */
export async function sendMemberMessage(
  admin: SupabaseClient,
  messageId: string,
  opts: { baseUrl: string; budgetMs?: number },
): Promise<SendResult> {
  const { data: msg } = await admin
    .from("member_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) {
    return { ok: false, status: "missing", recipientCount: 0, sentCount: 0, remaining: 0, error: "message not found" };
  }
  const message = msg as MemberMessage;
  // 「配信済」でも未送信（pending）が残っていれば続きを送れる（失敗分再送や、
  // 完了判定の競合で早く sent になってしまった場合の復旧経路）。
  const wasSent = message.status === "sent";
  if (message.status === "canceled") {
    return {
      ok: true,
      status: message.status,
      recipientCount: message.recipient_count,
      sentCount: message.sent_count,
      remaining: 0,
    };
  }
  if (wasSent) {
    const { count: pendingNow } = await admin
      .from("member_message_recipients")
      .select("id", { count: "exact", head: true })
      .eq("message_id", messageId)
      .eq("email_status", "pending");
    if (!pendingNow) {
      return {
        ok: true,
        status: message.status,
        recipientCount: message.recipient_count,
        sentCount: message.sent_count,
        remaining: 0,
      };
    }
    // 会員向けお知らせは status='sent' のみ表示されるため（mypage/announcements）、
    // 再送のあいだも 'sent' を維持し、お知らせが一時的に消えるのを防ぐ。
  } else {
    // 配信中に遷移
    await admin.from("member_messages").update({ status: "sending" }).eq("id", messageId);
  }

  // 配信先を未生成なら materialize（1会員1行・冪等）
  const { count: existing } = await admin
    .from("member_message_recipients")
    .select("id", { count: "exact", head: true })
    .eq("message_id", messageId);
  if (!existing) {
    const customers = await resolveAudienceCustomers(admin, message);
    const rows = customers.map((c) => ({
      message_id: messageId,
      customer_id: c.id,
      email: c.email,
      email_status:
        message.channel_email && c.email && !c.newsletter_opt_out ? "pending" : "skipped",
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await admin
        .from("member_message_recipients")
        .upsert(rows.slice(i, i + 500), {
          onConflict: "message_id,customer_id",
          ignoreDuplicates: true,
        });
    }
  }

  // メール配信（時間/件数バジェット内）
  let throttled = false;
  let throttleReason: string | undefined;
  if (message.channel_email) {
    const budgetMs = Math.max(1_000, Math.min(opts.budgetMs ?? SEND_TIME_BUDGET_MS, SEND_TIME_BUDGET_MS));
    const start = Date.now();
    // クレームの締め切り（送信そのものは締め切り後も完了まで待つ）
    const claimDeadline = start + Math.max(budgetMs - CLAIM_HEADROOM_MS, 2_000);

    // Gmail 想定の日次上限を先にチェックする。取得に失敗した場合は「送れる」と
    // 楽観視せず保留にする（cron / 再実行が後で再チェックする）。
    const { count: recentSent, error: capError } = await countRecentBulkSends(admin);
    let dailyRemaining = capError ? 0 : Math.max(0, NEWSLETTER_DAILY_CAP - recentSent);
    if (capError) {
      throttled = true;
      throttleReason = `日次上限の確認に失敗したため保留しました: ${capError}`;
    } else if (dailyRemaining <= 0) {
      throttled = true;
      throttleReason = `送信元メールアカウントの日次上限想定（${NEWSLETTER_DAILY_CAP}通/24時間）に達したため、本日はこれ以上送信せず保留しました。`;
    }

    let processed = 0;
    while (!throttled && processed < MAX_PER_CALL && Date.now() < claimDeadline) {
      const { data: batch, error: batchError } = await admin
        .from("member_message_recipients")
        .select("id, customer_id, email, token, customer:customers(full_name)")
        .eq("message_id", messageId)
        .eq("email_status", "pending")
        .order("id", { ascending: true })
        .limit(FETCH_CHUNK_SIZE);
      if (batchError) {
        // DB 側の一時障害。リトライで叩き続けず今回は打ち切る（cron / 再実行で再開）。
        throttled = true;
        throttleReason = `db error: ${batchError.message}`;
        break;
      }
      if (!batch || batch.length === 0) break;
      let claimedAny = false;
      for (const r of batch as any[]) {
        // 送信中に関数が強制終了されると「送信済み記録だけ残って実際は未送信」に
        // なるため、締め切り後は新しい行をクレームしない。
        if (processed >= MAX_PER_CALL || Date.now() >= claimDeadline) break;
        const name = r.customer?.full_name ?? null;
        const html = renderEmailHtml({
          name,
          title: message.title,
          body: message.body,
          bodyFormat: message.body_format,
          baseUrl: opts.baseUrl,
          token: r.token,
          imageUrls: message.image_urls,
          pdfUrls: message.pdf_urls,
        });
        const text = renderEmailText({
          name,
          title: message.title,
          body: message.body,
          bodyFormat: message.body_format,
          baseUrl: opts.baseUrl,
          token: r.token,
          imageUrls: message.image_urls,
          pdfUrls: message.pdf_urls,
        });
        // 送信前に行を pending → sent へ条件付きで「先取り」する。管理画面の
        // 自動継続・cron・失敗分再送が同時に走っても、先取りできた側だけが
        // 送信するため同じ会員に二重送信しない（0行更新なら他プロセスが担当中）。
        const { data: claimed, error: claimError } = await admin
          .from("member_message_recipients")
          .update({ email_status: "sent", sent_at: new Date().toISOString(), error: null })
          .eq("id", r.id)
          .eq("email_status", "pending")
          .select("id");
        if (claimError) {
          // DB 障害と「他プロセスが担当中」を混同しない。障害時は打ち切って後で再開。
          throttled = true;
          throttleReason = `db error: ${claimError.message}`;
          break;
        }
        if (!claimed || claimed.length === 0) continue;
        claimedAny = true;
        const res = await notify({
          kind: "member_message",
          to: r.email,
          to_name: name,
          subject: message.title,
          body_text: text,
          body_html: html,
          meta: { message_id: messageId, recipient_id: r.id },
        });
        if (res.sent) {
          processed++;
          dailyRemaining--;
          if (dailyRemaining <= 0) {
            // 送信中に日次上限想定に達した。ここで打ち切り、残りは cron / 再実行で
            // 翌日以降に自動送信する。
            throttled = true;
            throttleReason = `送信元メールアカウントの日次上限想定（${NEWSLETTER_DAILY_CAP}通/24時間）に達したため、残りは翌日以降に自動送信します。`;
            break;
          }
          continue;
        }
        if (isInfrastructureSendError(res.error)) {
          // 認証失敗・レート制限・接続障害など基盤側の問題: この受信者を pending に
          // 戻して（エラー文言は記録）、この呼び出しの送信を打ち切る。以降の送信も
          // 同じ理由で失敗することがほぼ確定しており、続行するとログイン試行を
          // 重ねて制限を悪化させるだけ。cron / 再実行が後で続きを送る。
          await admin
            .from("member_message_recipients")
            .update({ email_status: "pending", sent_at: null, error: res.error ?? "transient send error" })
            .eq("id", r.id);
          throttled = true;
          throttleReason = res.error ?? "transient send error";
          break;
        }
        // 宛先固有の失敗（アドレス不正等）: failed とし、「失敗分を再送」で復旧可能。
        await admin
          .from("member_message_recipients")
          .update({ email_status: "failed", sent_at: null, error: res.error ?? "send failed" })
          .eq("id", r.id);
        processed++;
      }
      // バッチ内の全行を他プロセスに先取りされた場合も次のフェッチで前進するが、
      // 相手が全件処理中なら空フェッチになるまで回さず一旦譲る。
      if (!claimedAny && batch.length < FETCH_CHUNK_SIZE) break;
    }
  }

  let counts: Awaited<ReturnType<typeof recomputeCounts>>;
  try {
    counts = await recomputeCounts(admin, messageId);
  } catch (e: any) {
    // カウントが取れないときに完了判定してはならない（pending を 0 と誤認して
    // 未送信を残したまま 'sent' 確定する事故を防ぐ）。状態は書き換えず終了し、
    // cron / 再実行に委ねる。
    return {
      ok: true,
      status: wasSent ? "sent" : "sending",
      recipientCount: message.recipient_count,
      sentCount: message.sent_count,
      remaining: 1,
      throttled: true,
      throttleReason: e?.message ?? "recipient counts unavailable",
    };
  }
  const done = counts.pending === 0;
  await admin
    .from("member_messages")
    .update({
      recipient_count: counts.total,
      sent_count: counts.sent,
      // 一度 'sent' になったメッセージは再送中も 'sent' を維持（お知らせ表示を守る）
      status: done || wasSent ? "sent" : "sending",
      sent_at: done ? message.sent_at ?? new Date().toISOString() : message.sent_at,
    })
    .eq("id", messageId);

  return {
    ok: true,
    status: done || wasSent ? "sent" : "sending",
    recipientCount: counts.total,
    sentCount: counts.sent,
    remaining: counts.pending,
    failedCount: counts.failed,
    throttled: throttled || undefined,
    throttleReason,
  };
}
