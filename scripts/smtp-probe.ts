/**
 * SMTP 疎通プローブ（メールは送信しない）。
 *
 *   npx tsx scripts/smtp-probe.ts               # MAIL_FROM 宛で検証
 *   npx tsx scripts/smtp-probe.ts you@x.com     # 外部宛でリレー許可まで検証
 *
 * ※ ローカル実行は「日本国内のIPからの結果」でしかない。本番（Vercel）の
 *    送信可否は必ず /api/admin/diagnostics/smtp で確認すること。
 *    2026-08-09 の障害は、ローカルでは成功し本番だけ全滅する形で発生した。
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

async function main() {
  const { probeSmtpRelay } = await import("../src/lib/smtpProbe");

  let egress = "";
  try {
    const r = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(5000) });
    const j: any = await r.json();
    egress = `（現在の送信元: ${j.ip} / ${j.country}）`;
    console.log(`実行元: ${j.ip}  ${j.country}  ${j.org ?? ""}`);
  } catch {
    console.log("実行元: (IP 取得できず)");
  }

  const result = await probeSmtpRelay({ rcptTo: process.argv[2], egressNote: egress });

  console.log(`\n${result.host}:${result.port} (${result.secure ? "TLS" : "plaintext"})`);
  console.log(`MAIL FROM: ${result.mailFrom}   RCPT TO: ${result.rcptTo}\n`);
  for (const s of result.stages) {
    const tag = s.ok ? "✅" : "❌";
    const cmd = s.command ? `C: ${s.command}` : "(接続)";
    console.log(`${tag} ${s.step.padEnd(10)} ${cmd}`);
    console.log(`   S: ${s.response.replace(/\n/g, "\n      ")}`);
  }
  console.log("");
  if (result.ok) {
    console.log("✅ 送信可能（接続・認証・宛先受理まで確認。DATA は送っていないためメールは未送信）");
  } else {
    console.log(`❌ 失敗: ${result.failedAt} — ${result.error ?? ""}`);
    if (result.hint) console.log(`💡 ${result.hint}`);
  }
  console.log(`(${result.durationMs}ms)`);
  process.exit(result.ok ? 0 : 2);
}

main().catch((e) => {
  console.error("probe error:", e);
  process.exit(1);
});
