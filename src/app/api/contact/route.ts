import { NextResponse } from "next/server";
import { z } from "zod";
import { contactAutoReplyTemplate, notify } from "@/lib/notify";

// 各フォームの送信先（クライアント指定）。環境変数 CONTACT_RECIPIENTS で上書き可。
const DEFAULT_RECIPIENTS = "info@retouch-members.com";

const schema = z.object({
  name: z.string().trim().min(1, "お名前を入力してください").max(120),
  email: z.string().trim().email("メールアドレスの形式が正しくありません"),
  phone: z.string().trim().max(20).optional().default(""),
  subject: z.string().trim().max(200).optional().default(""),
  message: z.string().trim().min(1, "お問い合わせ内容を入力してください").max(5000),
  // Honeypot — bots fill this; humans never see it.
  company: z.string().optional().default(""),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容をご確認ください。" },
      { status: 400 },
    );
  }
  const { name, email, phone, subject, message, company } = parsed.data;

  // Honeypot hit → pretend success, send nothing.
  if (company.trim() !== "") return NextResponse.json({ ok: true });

  const recipients = process.env.CONTACT_RECIPIENTS ?? DEFAULT_RECIPIENTS;
  const subj = subject.trim()
    ? `【お問い合わせ】${subject.trim()}`
    : "【お問い合わせ】Webフォームより";
  const body =
    `Retouchサイトのお問い合わせフォームから送信がありました。\n\n` +
    `お名前　: ${name}\n` +
    `メール　: ${email}\n` +
    `電話番号: ${phone.trim() || "（未入力）"}\n` +
    `件名　　: ${subject.trim() || "（なし）"}\n\n` +
    `── お問い合わせ内容 ──────────────\n` +
    `${message}\n` +
    `────────────────────────────\n\n` +
    `※ このメールに返信すると、送信者（${email}）へ直接返信できます。`;

  const res = await notify({
    kind: "contact_inquiry",
    to: recipients,
    subject: subj,
    body_text: body,
    reply_to: email, // staff can reply directly to the submitter
    meta: { name, email, subject: subject.trim() || null, source: "home_contact_form" },
  });

  if (!res.sent) {
    // Surface the underlying reason in the server log to aid diagnosis
    // (e.g. "smtp not configured" → restart after editing .env.local;
    //  a connection timeout → outbound SMTP is blocked on this network).
    console.error(`[contact] send failed via ${res.transport}: ${res.error ?? "unknown error"}`);
    return NextResponse.json(
      { error: "送信に失敗しました。時間をおいて再度お試しいただくか、お電話でお問い合わせください。" },
      { status: 502 },
    );
  }

  // 送信者本人への自動返信（受付確認）。失敗してもフォーム送信自体は成功とする。
  const ack = contactAutoReplyTemplate({ name, subject: subject.trim(), message });
  await notify({
    kind: "contact_auto_reply",
    to: email,
    to_name: name,
    subject: ack.subject,
    body_text: ack.body_text,
    meta: { source: "home_contact_form_ack" },
  });

  return NextResponse.json({ ok: true });
}
