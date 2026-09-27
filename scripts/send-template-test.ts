/**
 * メルマガ（会員向けメッセージ配信）テンプレートの送信テスト。
 * 実際の renderEmailHtml / renderEmailText を使って HTML メールを送信する。
 *
 * Usage:
 *   npx tsx scripts/send-template-test.ts                  # MAIL_FROM 宛
 *   npx tsx scripts/send-template-test.ts you@example.com  # 宛先指定
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
import nodemailer from "nodemailer";
import { renderEmailHtml, renderEmailText } from "../src/lib/memberMessages";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

async function main() {
  const to = process.argv[2] ?? process.env.MAIL_FROM ?? "unaniiyashiwo@gmail.com";

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.error("✗ SMTP_HOST / SMTP_USER / SMTP_PASS が未設定です。.env.local をご確認ください。");
    process.exit(1);
  }

  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "")) || "https://retouch-members.example.com";
  // テスト用のダミートークン（開封ピクセル・配信停止リンクの形を確認するため）
  const token = "00000000-0000-0000-0000-000000000000";

  const title = "【Retouch Members】メールマガジン配信テスト";
  const body = `<p>いつも引退競走馬へのあたたかいご支援をありがとうございます。</p>
<p>本メールは、新しく追加した<strong>メールマガジン配信機能</strong>のテンプレート確認用テスト配信です。HTMLメールの表示・開封トラッキング・配信停止リンクが正しく動作するかをご確認いただけます。</p>
<ul>
  <li>お知らせ：マイページからも同じ内容をご覧いただけます</li>
  <li>イベント：見学会・馬の面会のご案内</li>
  <li>活動報告：馬たちの近況レポート</li>
</ul>
<p>引き続き、どうぞよろしくお願いいたします。</p>`;

  const html = renderEmailHtml({ name: "テスト送信", title, body, bodyFormat: "html", baseUrl, token });
  const text = renderEmailText({ name: "テスト送信", title, body, bodyFormat: "html", baseUrl, token });

  const tx = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false",
    auth: { user, pass },
  });

  const fromName = process.env.MAIL_FROM_NAME ?? "Retouchメンバーズ事務局";
  const fromAddr = process.env.MAIL_FROM ?? user;

  console.log(`→ Sending template mail via ${host}:${process.env.SMTP_PORT ?? 465}`);
  console.log(`  From: ${fromName} <${fromAddr}>`);
  console.log(`  To:   ${to}`);
  console.log(`  Base: ${baseUrl}`);
  try {
    const info = await tx.sendMail({
      from: `${fromName} <${fromAddr}>`,
      to,
      subject: title,
      text,
      html,
      replyTo: process.env.CONTACT_EMAIL ?? fromAddr,
      headers: { "List-Unsubscribe": `<${baseUrl}/api/newsletter/unsubscribe?t=${token}>` },
    });
    console.log(`✅ ok: messageId=${info.messageId}`);
  } catch (e: any) {
    console.error("✗ send failed:", e?.message ?? e);
    process.exit(2);
  }
}

main();
