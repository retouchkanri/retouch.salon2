import nodemailer, { type Transporter } from "nodemailer";
import { createSupabaseAdminClient } from "./supabase/admin";
import { pickupLabel, relationLabel, venueLabel, type Venue } from "./events";
import type { BookingCompanion } from "@/types/db";

/**
 * Notification layer.
 *
 * Transports (selected via NOTIFY_TRANSPORT env):
 *   - "smtp"  : nodemailer (Gmail SMTP via SMTP_* env). Default in this project.
 *   - "resend": Resend HTTP API (RESEND_API_KEY).
 *   - "audit" : no actual delivery, only audit_logs trail (dev/local).
 *
 * Every send attempt — successful or not — writes an `audit_logs`
 * row so the admin can trace mail history at /admin/audit-logs.
 */

export type NotifyKind =
  | "donation_thanks"
  | "donation_bank_transfer"
  | "booking_confirmed"
  | "booking_canceled"
  | "payment_failed"
  | "plan_changed"
  | "support_added"
  | "support_changed"
  | "support_canceled"
  | "contact_inquiry"
  | "contact_auto_reply"
  | "password_reset"
  | "registration_verify"
  | "member_welcome"
  | "profile_updated"
  | "horse_meeting_received"
  | "member_message"
  | "staff_notify";

export type NotifyPayload = {
  kind: NotifyKind;
  /** Recipient(s). Comma-separated string for multiple addresses. */
  to: string | null;
  to_name?: string | null;
  subject: string;
  body_text: string;
  /** Optional HTML body (newsletters). When set, sent alongside the text part. */
  body_html?: string | null;
  /** Overrides the default Reply-To (e.g. set to the form submitter's address). */
  reply_to?: string | null;
  /** Extra SMTP headers (e.g. List-Unsubscribe for メルマガ). */
  headers?: Record<string, string>;
  meta?: Record<string, unknown>;
};

const FROM_NAME_DEFAULT = "Retouchメンバーズ事務局";
const SITE_URL_DEFAULT = "https://retouch-members.local";
const CONTACT_EMAIL_DEFAULT = "info@retouch-members.local";
const STAFF_RECIPIENTS_DEFAULT = "info@retouch-members.com";

/** スタッフ通知の宛先。CONTACT_RECIPIENTS 環境変数で上書き可。 */
export function staffRecipients(): string {
  return process.env.CONTACT_RECIPIENTS ?? STAFF_RECIPIENTS_DEFAULT;
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL_DEFAULT;
}

function contactEmail() {
  return process.env.CONTACT_EMAIL ?? process.env.MAIL_FROM ?? CONTACT_EMAIL_DEFAULT;
}

function fromHeader(): string {
  const addr = process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "no-reply@retouch-members.local";
  const name = process.env.MAIL_FROM_NAME ?? FROM_NAME_DEFAULT;
  return `${name} <${addr}>`;
}

function fromEmailAddress(): string {
  const raw = process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "no-reply@retouch-members.local";
  const angle = raw.match(/<([^>]+)>/);
  return (angle?.[1] ?? raw).trim();
}

function fromEmailDomain(): string {
  return fromEmailAddress().split("@")[1] ?? "retouch-members.com";
}

const PERSONAL_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.co.jp",
  "yahoo.com",
  "ezweb.ne.jp",
  "au.com",
  "icloud.com",
  "me.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
]);

/** 個人メールやドメイン不一致は Spam 判定の主因。設定ミスをサーバーログに残す。 */
function warnDeliverabilityRisk(): void {
  const domain = fromEmailDomain().toLowerCase();
  if (PERSONAL_MAIL_DOMAINS.has(domain)) {
    console.warn(
      "[notify] Sending from a personal mailbox (%s). Transactional mail often lands in spam. " +
        "Use info@retouch-members.com via Xserver SMTP (see .env.local.example).",
      domain,
    );
  }
  try {
    const siteHost = new URL(siteUrl()).hostname.toLowerCase();
    if (
      siteHost &&
      !siteHost.includes("localhost") &&
      !siteHost.endsWith(".local") &&
      domain &&
      domain !== siteHost &&
      !siteHost.endsWith(`.${domain}`)
    ) {
      console.warn(
        "[notify] MAIL_FROM domain (%s) does not match site host (%s); SPF/DKIM/DMARC alignment may fail.",
        domain,
        siteHost,
      );
    }
  } catch {
    // ignore
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** プレーンテキストを multipart 送信用 HTML に変換（URL はリンク化）。 */
function textToHtmlEmail(text: string): string {
  const escaped = escapeHtml(text);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2d6a4f;word-break:break-all;">$1</a>',
  );
  const paras = linked
    .split(/\n\n+/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;line-height:1.75;color:#1f2937;">${p.replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  return (
    `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:24px 16px;background:#f7f8fa;font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Meiryo',sans-serif;font-size:15px;">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px;">` +
    paras +
    `</div></body></html>`
  );
}

function transactionalHeaders(kind: NotifyKind): Record<string, string> {
  const tag = `${kind}.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
  return {
    "Message-ID": `<${tag}@${fromEmailDomain()}>`,
    "X-Auto-Response-Suppress": "OOF, AutoReply",
  };
}

function resolveHtmlBody(p: NotifyPayload): string {
  return p.body_html ?? textToHtmlEmail(p.body_text);
}

function parseRecipients(to: string): string[] {
  return to.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * 送信してよいメールアドレスか（空白・山かっこ・引用符などを含まない、ドメインにドットがある普通の形式）。
 *
 * 2026-09-28 の障害: 会員情報に "seiko.a 96@gmail.com" のような空白入りのアドレスがあり、
 * nodemailer がこれを「名前 seiko.a ＋ 宛先 96@gmail.com」と解釈して、無関係の第三者へ
 * 会員の名前入りメールを送っていた。形式が不正なアドレスには絶対に送らない。
 */
export function isValidEmailAddress(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim();
  if (e.length > 254 || /[\s<>()\[\],;:"\\]/.test(e)) return false;
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
    e,
  );
}

/** 宛先の形式エラー（宛先固有の失敗。基盤障害ではない） */
function invalidRecipientError(to: string): string {
  return `invalid recipient address (not sent to prevent misdelivery): ${JSON.stringify(to)}`;
}

/** 環境変数を正の数値として読む。未設定・空文字・不正値は既定値に落とす。 */
export function numEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function smtpBaseConfig(): { host: string; port: number; secure: boolean; auth: { user: string; pass: string } } | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    port: numEnv("SMTP_PORT", 465),
    secure: (process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false",
    auth: { user, pass },
  };
}

/**
 * トランスポートは2系統に分ける。
 *   - 都度接続（既定）: 予約確認・パスワード再設定などの単発トランザクションメール。
 *     サーバレスの凍結中にプールのソケットが死ぬと1通目が失われるため、
 *     少量・即時性重視のメールは従来どおり毎回接続するのが最も確実。
 *   - プール接続（一斉配信 kind='member_message' 専用）: 1通ごとに再ログインすると
 *     Gmail は数十回で "454-4.7.0 Too many login attempts" を返して全滅する
 *     （2026-08-03 の613件配信が85通で停止した実障害）。1ログイン=多数通に集約し、
 *     送信レートも既定 1通/秒 に抑えてバースト検知を避ける。
 */
let _smtp: Transporter | null = null;
let _smtpBulk: Transporter | null = null;

function smtpTransport(): Transporter | null {
  if (_smtp) return _smtp;
  const base = smtpBaseConfig();
  if (!base) return null;
  _smtp = nodemailer.createTransport({
    ...base,
    // Fail fast if the SMTP host is unreachable/blocked instead of hanging the request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return _smtp;
}

function smtpBulkTransport(): Transporter | null {
  if (_smtpBulk) return _smtpBulk;
  const base = smtpBaseConfig();
  if (!base) return null;
  _smtpBulk = nodemailer.createTransport({
    ...base,
    pool: true,
    maxConnections: numEnv("SMTP_MAX_CONNECTIONS", 1),
    // Gmail は1セッション約100通で切られるため、余裕をみて90通で自主再接続。
    maxMessages: numEnv("SMTP_MAX_MESSAGES", 90),
    rateDelta: numEnv("SMTP_RATE_DELTA", 1000),
    rateLimit: numEnv("SMTP_RATE_LIMIT", 1),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    // レート待ちやDB往復で正当な無通信区間ができるため単発用より長めにとる。
    socketTimeout: 30_000,
  });
  return _smtpBulk;
}

async function sendViaSmtp(p: NotifyPayload): Promise<{ ok: boolean; error?: string }> {
  if (!p.to) return { ok: false, error: "no recipient" };
  const tx = p.kind === "member_message" ? smtpBulkTransport() : smtpTransport();
  if (!tx) return { ok: false, error: "smtp not configured" };
  const recipients = parseRecipients(p.to);
  // 形式が不正な宛先が1つでもあれば送らない（誤った第三者への送信を防ぐ）
  const bad = recipients.find((r) => !isValidEmailAddress(r));
  if (recipients.length === 0 || bad) return { ok: false, error: invalidRecipientError(bad ?? p.to) };
  try {
    await tx.sendMail({
      from: fromHeader(),
      // 宛名は文字列に埋め込まず { name, address } で渡す（名前の記号で宛先が崩れないように）
      to:
        recipients.length === 1
          ? p.to_name
            ? { name: p.to_name, address: recipients[0] }
            : recipients[0]
          : recipients,
      subject: p.subject,
      text: p.body_text,
      html: resolveHtmlBody(p),
      replyTo: p.reply_to ?? contactEmail(),
      headers: { ...transactionalHeaders(p.kind), ...(p.headers ?? {}) },
      envelope: {
        from: fromEmailAddress(),
        to: recipients,
      },
    });
    return { ok: true };
  } catch (e: any) {
    // nodemailer はソケット系の失敗を e.code（ESOCKET / ETIMEDOUT 等）で表現し、
    // message には "Unexpected socket close" のような文言しか入らないことがある。
    // エラー分類（isInfrastructureSendError）が判定できるよう code も含める。
    const msg = e?.message ?? "smtp send failed";
    return { ok: false, error: e?.code ? `${e.code}: ${msg}` : msg };
  }
}

async function sendViaResend(p: NotifyPayload): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !p.to) return { ok: false, error: "resend not configured" };
  if (!isValidEmailAddress(p.to)) return { ok: false, error: invalidRecipientError(p.to) };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromHeader(),
        to: [p.to],
        subject: p.subject,
        text: p.body_text,
        html: resolveHtmlBody(p),
        reply_to: p.reply_to ?? contactEmail(),
        headers: { ...transactionalHeaders(p.kind), ...(p.headers ?? {}) },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `resend http ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "resend send failed" };
  }
}

export async function notify(payload: NotifyPayload): Promise<{
  sent: boolean;
  transport: string;
  error?: string;
}> {
  const transport = (process.env.NOTIFY_TRANSPORT ?? "smtp").toLowerCase();
  let result: { ok: boolean; error?: string } = { ok: false, error: "no transport" };

  if (payload.to) {
    warnDeliverabilityRisk();
    if (transport === "smtp") result = await sendViaSmtp(payload);
    else if (transport === "resend") result = await sendViaResend(payload);
    else result = { ok: false, error: "audit-only mode" };
  } else {
    result = { ok: false, error: "no recipient" };
  }

  try {
    const admin = createSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      action: `notify.${payload.kind}`,
      target_table: "notifications",
      meta: {
        to: payload.to,
        to_name: payload.to_name ?? null,
        subject: payload.subject,
        // パスワード再設定メールには使い捨ての再設定URL（トークン）が含まれるため、
        // 監査ログに本文プレビューを残さない（管理者にもトークンを見せない）。
        preview:
          payload.kind === "password_reset" ? "[redacted]" : payload.body_text.slice(0, 400),
        transport,
        sent: result.ok,
        error: result.error ?? null,
        ...(payload.meta ?? {}),
      },
    });
  } catch {
    // logging must not break the caller
  }
  return { sent: result.ok, transport, error: result.error };
}

// =====================================================================
// Templates
// =====================================================================

function signature(): string {
  return (
    `\n\n` +
    `——————————————————\n` +
    `Retouchメンバーズサイト 運営事務局\n` +
    `お問い合わせ: ${contactEmail()}\n` +
    `マイページ: ${siteUrl()}/mypage`
  );
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

/** 日本時間の「2026年10月20日」。日時が不正なら null。 */
function jaDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function donationThanksTemplate(params: {
  name: string | null;
  amount: number;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "ご支援者";
  return {
    subject: "【Retouch Members】ご寄付ありがとうございます",
    body_text:
      `${who}様\n\n` +
      `このたびは引退競走馬への温かいご寄付（${yen(params.amount)}）を賜り、誠にありがとうございます。\n` +
      `いただいたご支援は、馬たちのケア・見学会の運営にありがたく活用させていただきます。\n\n` +
      `本メールは寄付受付の確認としてお送りしております。` +
      signature(),
  };
}

export function donationBankTransferTemplate(params: {
  name: string | null;
  amount: number;
  bankInfoText: string;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "ご支援者";
  return {
    subject: "【Retouch Members】ご寄付のお申し込みを受け付けました（銀行振込のご案内）",
    body_text:
      `${who}様\n\n` +
      `このたびは引退競走馬への温かいご寄付をお申し込みいただき、誠にありがとうございます。\n` +
      `下記の口座へ、お振込金額 ${yen(params.amount)} のお振込をお願いいたします。\n\n` +
      `${params.bankInfoText}\n` +
      `※お振込の確認後、あらためて受領のご連絡をお送りいたします。\n` +
      `※恐れ入りますが、振込手数料はご負担いただきますようお願いいたします。` +
      signature(),
  };
}

export function contactAutoReplyTemplate(params: {
  name: string | null;
  subject: string;
  message: string;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "お客";
  return {
    subject: "【Retouch Members】お問い合わせを受け付けました",
    body_text:
      `${who}様\n\n` +
      `このたびはお問い合わせをいただき、誠にありがとうございます。\n` +
      `以下の内容で受け付けいたしました。担当者より順次ご返信いたしますので、今しばらくお待ちください。\n\n` +
      (params.subject ? `件名: ${params.subject}\n` : "") +
      `── お問い合わせ内容 ──────────────\n` +
      `${params.message}\n` +
      `────────────────────────────\n\n` +
      `※ 本メールは自動送信です。お心当たりのない場合は破棄してください。` +
      signature(),
  };
}

export function passwordResetTemplate(params: {
  name: string | null;
  /** パスワード再設定ページの完全なURL（token_hash 付き）。 */
  url: string;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "会員";
  return {
    subject: "【Retouch Members】パスワード再設定のご案内",
    body_text:
      `${who}様\n\n` +
      `Retouchメンバーズサイトのパスワード再設定のお申し込みを受け付けました。\n` +
      `下記のURLを開き、新しいパスワードを設定してください。\n\n` +
      `▼ パスワード再設定URL（有効期限：1時間）\n` +
      `${params.url}\n\n` +
      `【ご案内】\n` +
      `・上記URLが青いリンクにならない場合は、URL全体をコピーし、ブラウザのアドレスバーに貼り付けて開いてください。\n` +
      `・うまく開けないときは、お申し込みをされたブラウザでお試しください。\n` +
      `・このお申し込みに心当たりがない場合は、本メールを破棄してください。パスワードは変更されません。` +
      signature(),
  };
}

export function paymentFailedTemplate(params: {
  name: string | null;
  contractId: string;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "会員";
  return {
    subject: "【Retouch Members】お支払いに関するご確認のお願い",
    body_text:
      `${who}様\n\n` +
      `ご登録のクレジットカードで決済が完了できない状況です。\n` +
      `お手数ですが、マイページ「お支払い情報を変更」よりカード情報のご確認・更新をお願いいたします。\n\n` +
      `更新後、自動的に再決済が行われます。手続き後にご不明な点がございましたら、本メールへご返信ください。` +
      signature(),
  };
}

export function bookingConfirmedTemplate(params: {
  name: string | null;
  eventTitle: string;
  startsAt: string | Date;
  venue?: Venue | null;
  pickup?: string | null;
  riding?: boolean;
  companions?: BookingCompanion[];
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "会員";
  const d = typeof params.startsAt === "string" ? new Date(params.startsAt) : params.startsAt;
  const when = Number.isNaN(d.getTime())
    ? String(params.startsAt)
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  // 見学会の申込内容（送迎・体験乗馬・同伴者）を本文に反映。
  const lines: string[] = [
    `・イベント: ${params.eventTitle}`,
    `・日時: ${when}`,
  ];
  if (params.venue) lines.push(`・会場: ${venueLabel(params.venue)}`);
  const pickup = pickupLabel(params.venue ?? null, params.pickup ?? null);
  lines.push(`・送迎: ${pickup ?? "希望しない"}`);
  if (params.venue === "chiba") lines.push(`・体験乗馬（約5分）: ${params.riding ? "希望する" : "希望しない"}`);
  const companions = params.companions ?? [];
  if (companions.length > 0) {
    lines.push(`・同伴者（${companions.length}名）:`);
    for (const c of companions) lines.push(`    - ${c.name}（${relationLabel(c.relation)}）`);
  }

  return {
    subject: `【Retouch Members】ご予約完了のお知らせ — ${params.eventTitle}`,
    body_text:
      `${who}様\n\n` +
      `以下の見学会のご予約を承りました。\n\n` +
      lines.join("\n") +
      `\n\n` +
      `当日の詳細・集合時間は別途ご連絡いたします。\n` +
      `ご予約のキャンセル・内容変更はマイページからお手続きいただけます。` +
      signature(),
  };
}

export function planChangedTemplate(params: {
  name: string | null;
  planName: string;
  monthly: number;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "会員";
  return {
    subject: `【Retouch Members】会員種別を変更しました — ${params.planName}`,
    body_text:
      `${who}様\n\n` +
      `会員種別を「${params.planName}（月額 ${yen(params.monthly)}）」に変更いたしました。\n` +
      `引き続きご支援のほどよろしくお願い申し上げます。` +
      signature(),
  };
}

export function supportAddedTemplate(params: {
  name: string | null;
  horseName: string;
  units: number;
  monthly: number;
  /**
   * 課金方法の案内文を切り替える。
   *   true（既定）: カードでの自動継続課金（会員セルフ申込）。
   *   false       : 運営による手動登録。請求方法は別途案内する旨に差し替える。
   */
  autoBill?: boolean;
  /**
   * 請求中の支援に口数を追加した場合の、新しい月額が適用される請求日（ISO）。
   * 口数の変更は次回の請求日から適用し、月の途中の日割り請求はしない。
   */
  effectiveFrom?: string | null;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "ご支援者";
  const u = Number.isInteger(params.units) ? `${params.units}口` : `${params.units.toFixed(1)}口`;
  const effective = jaDate(params.effectiveFrom);
  const billingLine =
    params.autoBill === false
      ? `お支払い方法・次回以降のご請求につきましては、事務局より別途ご案内いたします。`
      : effective
        ? `追加後の月額は ${effective} のご請求から適用されます（月の途中の日割りのご請求はありません）。`
        : `次回以降、毎月ご請求させていただきます。`;
  return {
    subject: `【Retouch Members】支援お申し込み完了のお知らせ — ${params.horseName}`,
    body_text:
      `${who}様\n\n` +
      `以下の内容で支援のお申し込みを承りました。\n\n` +
      `・対象馬: ${params.horseName}\n` +
      `・口数: ${u}\n` +
      `・月額: ${yen(params.monthly)}\n\n` +
      `${billingLine}\n` +
      `心温まるご支援を誠にありがとうございます。` +
      signature(),
  };
}

export function supportChangedTemplate(params: {
  name: string | null;
  horseName: string;
  prevUnits: number;
  prevMonthly: number;
  newUnits: number;
  newMonthly: number;
  /** 変更後の月額が適用される請求日（ISO）。無い場合は日付を示さない案内にする。 */
  effectiveFrom?: string | null;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "ご支援者";
  const fmt = (n: number) => (Number.isInteger(n) ? `${n}口` : `${n.toFixed(1)}口`);
  const effective = jaDate(params.effectiveFrom);
  return {
    subject: `【Retouch Members】支援内容変更のお知らせ — ${params.horseName}`,
    body_text:
      `${who}様\n\n` +
      `${params.horseName}の支援内容を以下のとおり変更いたしました。\n\n` +
      `【変更前】 ${fmt(params.prevUnits)} / 月額 ${yen(params.prevMonthly)}\n` +
      `【変更後】 ${fmt(params.newUnits)} / 月額 ${yen(params.newMonthly)}\n\n` +
      (effective
        ? `変更後の月額は ${effective} のご請求から適用されます。月の途中の変更による日割りのご請求・返金はありません。`
        : `変更後の月額で、毎月ご請求させていただきます。`) +
      signature(),
  };
}

export function supportCanceledTemplate(params: {
  name: string | null;
  horseName: string;
  scheduledAt: string | null;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "ご支援者";
  const when = params.scheduledAt
    ? (() => {
        const d = new Date(params.scheduledAt as string);
        return Number.isNaN(d.getTime())
          ? null
          : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      })()
    : null;
  return {
    subject: `【Retouch Members】支援停止 受付のお知らせ — ${params.horseName}`,
    body_text:
      `${who}様\n\n` +
      `${params.horseName}の支援停止のお申し込みを承りました。\n\n` +
      (when
        ? `・終了予定日: ${when}\n  当日まではご支援を継続いただけます。\n\n`
        : `・即日で停止いたしました。\n\n`) +
      `これまでの温かいご支援、誠にありがとうございました。` +
      signature(),
  };
}

export function memberWelcomeTemplate(params: {
  name: string | null;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "会員";
  return {
    subject: "【Retouch Members】ご入会ありがとうございます",
    body_text:
      `${who}様\n\n` +
      `このたびはRetouchメンバーズにご入会いただき、誠にありがとうございます。\n` +
      `アカウントの設定が完了しました。下記よりログインしてマイページをご利用ください。\n\n` +
      `▼ ログイン\n` +
      `${siteUrl()}/login\n\n` +
      `ご不明な点がございましたら、お気軽にお問い合わせください。` +
      signature(),
  };
}

/**
 * 仮会員登録（メール確認）メール。入力されたメール宛に、アカウント作成ページへの
 * 確認リンクを送る。
 */
export function registrationVerifyTemplate(params: {
  url: string;
}): Pick<NotifyPayload, "subject" | "body_text" | "body_html"> {
  const subject = "【Retouch Members】会員登録のご確認";
  const body_text =
    `この度は、引退競走馬支援「Retouch（リタッチ）」へのご登録ありがとうございます。\n\n` +
    `以下のリンクから、24時間以内にアカウント作成（本登録）を完了してください。\n\n` +
    `▼ アカウント作成ページ\n` +
    `${params.url}\n\n` +
    `【ご案内】\n` +
    `・リンクが開けない場合は、URL全体をコピーしてブラウザのアドレスバーに貼り付けてください。\n` +
    `・本メールに心当たりがない場合は破棄してください。\n` +
    `・このメールは登録申込を受け付けた方へ自動送信しています。` +
    signature();

  const safeUrl = escapeHtml(params.url);
  const contact = escapeHtml(contactEmail());
  const loginUrl = escapeHtml(`${siteUrl()}/login`);

  const body_html =
    `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:24px 16px;background:#f7f8fa;font-family:'Hiragino Sans','Meiryo',sans-serif;font-size:15px;color:#1f2937;">` +
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px;">` +
    `<p style="margin:0 0 16px;line-height:1.75;">この度は、引退競走馬支援「Retouch（リタッチ）」へのご登録ありがとうございます。</p>` +
    `<p style="margin:0 0 20px;line-height:1.75;">以下のボタンから、<strong>24時間以内</strong>にアカウント作成（本登録）を完了してください。</p>` +
    `<p style="margin:0 0 24px;text-align:center;">` +
    `<a href="${safeUrl}" style="display:inline-block;background:#2d6a4f;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:8px;">アカウント作成ページを開く</a>` +
    `</p>` +
    `<p style="margin:0 0 8px;font-size:13px;color:#6b7280;">リンクが開けない場合は、下記URLをコピーしてブラウザに貼り付けてください。</p>` +
    `<p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${safeUrl}" style="color:#2d6a4f;">${safeUrl}</a></p>` +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">` +
    `<p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">Retouchメンバーズサイト 運営事務局<br>` +
    `お問い合わせ: <a href="mailto:${contact}" style="color:#2d6a4f;">${contact}</a><br>` +
    `ログイン: <a href="${loginUrl}" style="color:#2d6a4f;">${loginUrl}</a></p>` +
    `</div></body></html>`;

  return { subject, body_text, body_html };
}

export function profileUpdatedTemplate(params: {
  name: string | null;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "会員";
  return {
    subject: "【Retouch Members】ご登録情報の変更を承りました",
    body_text:
      `${who}様\n\n` +
      `ご登録情報（お名前・ご連絡先・ご住所など）の変更手続きが完了いたしました。\n` +
      `内容はマイページの「登録情報」よりご確認いただけます。\n\n` +
      `※ お心当たりのない変更の場合は、お手数ですが本メールへご返信ください。` +
      signature(),
  };
}

export function horseMeetingReceivedTemplate(params: {
  name: string | null;
  facility: string;
  preferredDate: string;
  timeSlot: string;
  partySize: number;
  supportedHorses: string;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "会員";
  return {
    subject: "【Retouch Members】馬の面会お申し込みを受け付けました",
    body_text:
      `${who}様\n\n` +
      `馬の面会のお申し込みを受け付けました。\n` +
      `担当者にて内容を確認のうえ、改めてご連絡いたします。\n\n` +
      `・施設: ${params.facility}\n` +
      `・ご希望日時: ${params.preferredDate} ${params.timeSlot}\n` +
      `・人数: ${params.partySize}名\n` +
      `・支援対象馬: ${params.supportedHorses}\n\n` +
      `※ 本メールは受付確認の自動送信です。` +
      signature(),
  };
}

export function bookingCanceledTemplate(params: {
  name: string | null;
  eventTitle: string;
  startsAt: string | Date;
}): Pick<NotifyPayload, "subject" | "body_text"> {
  const who = params.name?.trim() || "会員";
  const d = typeof params.startsAt === "string" ? new Date(params.startsAt) : params.startsAt;
  const when = Number.isNaN(d.getTime())
    ? String(params.startsAt)
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return {
    subject: `【Retouch Members】ご予約のキャンセル — ${params.eventTitle}`,
    body_text:
      `${who}様\n\n` +
      `以下のご予約をキャンセルいたしました。\n\n` +
      `・イベント: ${params.eventTitle}\n` +
      `・日時: ${when}\n\n` +
      `またのご参加をお待ちしております。` +
      signature(),
  };
}
