/**
 * Quick SMTP smoke test.
 *
 * Usage:
 *   npx tsx scripts/smtp-test.ts            # sends to MAIL_FROM
 *   npx tsx scripts/smtp-test.ts you@x.com  # sends to custom recipient
 *
 * Reads SMTP_* and MAIL_FROM/MAIL_FROM_NAME from .env.local.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
import nodemailer from "nodemailer";

// Load .env.local (Next.js convention) first, then .env as fallback.
loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

async function main() {
  const to = process.argv[2] ?? process.env.MAIL_FROM;
  if (!to) {
    console.error("✗ no recipient. set MAIL_FROM in .env.local or pass an address as the first argument.");
    process.exit(1);
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.error("✗ SMTP_HOST / SMTP_USER / SMTP_PASS が未設定です。.env.local をご確認ください。");
    process.exit(1);
  }

  const tx = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false",
    auth: { user, pass },
  });

  const fromName = process.env.MAIL_FROM_NAME ?? "Retouchメンバーズ事務局";
  const fromAddr = process.env.MAIL_FROM ?? user;

  console.log(`→ Sending test mail via ${host}:${process.env.SMTP_PORT ?? 465} ...`);
  console.log(`  From: ${fromName} <${fromAddr}>`);
  console.log(`  To:   ${to}`);
  try {
    const info = await tx.sendMail({
      from: `${fromName} <${fromAddr}>`,
      to,
      subject: "[テスト] Retouchメンバーズ SMTP 疎通確認",
      text:
        "このメールは Retouchメンバーズサイトの SMTP 設定確認用テストメールです。\n" +
        "本メールが届いていれば、本番のお礼メール・予約完了メール等も送信可能です。\n" +
        "\n— scripts/smtp-test.ts より\n",
    });
    console.log(`✅ ok: messageId=${info.messageId}`);
  } catch (e: any) {
    console.error("✗ send failed:", e?.message ?? e);
    process.exit(2);
  }
}

main();
