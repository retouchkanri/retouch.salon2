import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { probeSmtpRelay } from "@/lib/smtpProbe";

/**
 * 本番環境（Vercel）から見た SMTP 疎通診断。メールは1通も送信しない。
 *
 *   GET /api/admin/diagnostics/smtp          … MAIL_FROM 宛で検証（自ドメイン）
 *   GET /api/admin/diagnostics/smtp?to=x@y.z … 外部ドメイン宛でリレー許可まで検証
 *
 * ローカルからの疎通確認（scripts/smtp-test.ts）は日本国内のIPから接続するため
 * 成功してしまい、本番の失敗を再現できない。2026-08-09 の障害はまさにこれで、
 * 「ローカルでは送れるのに本番だけ全滅」した。判定は必ず本番の実行環境から行う。
 */

export const runtime = "nodejs"; // node:net / node:tls を使うため Edge 不可
export const dynamic = "force-dynamic";
// 送信系（member-messages の send / cron）と同一リージョンで診断しないと、
// 検証した送信元IPが本番と別物になり意味をなさない。vercel.json と揃えること。
export const preferredRegion = "hnd1";
export const maxDuration = 60;

/** 実行環境の外向きIPと国。取得失敗は診断全体を止めない。 */
async function egressIdentity(): Promise<{ ip: string | null; country: string | null; org: string | null }> {
  try {
    const res = await fetch("https://ipinfo.io/json", {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { ip: null, country: null, org: null };
    const j: any = await res.json();
    return { ip: j.ip ?? null, country: j.country ?? null, org: j.org ?? null };
  } catch {
    return { ip: null, country: null, org: null };
  }
}

export async function GET(req: Request) {
  await requireCapability("messages.manage");

  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? undefined;

  const region = process.env.VERCEL_REGION ?? null;
  const egress = await egressIdentity();

  const egressNote = egress.ip
    ? `（現在の送信元: ${egress.ip}${egress.country ? ` / ${egress.country}` : ""}${
        region ? ` / Vercel ${region}` : ""
      }）`
    : "";

  const probe = await probeSmtpRelay({ rcptTo: to, egressNote });

  // 国外IPからの送信は Xserver の国外IPアクセス制限に抵触する。成功していても警告する。
  const warnings: string[] = [];
  if (egress.country && egress.country !== "JP") {
    warnings.push(
      `送信元IPが日本国外（${egress.country}）です。Xserver の国外IPアクセス制限に抵触します。` +
        `vercel.json の regions を "hnd1"（東京）に固定してください。`,
    );
  }
  if (region && region !== "hnd1") {
    warnings.push(`実行リージョンが ${region} です（期待値: hnd1）。vercel.json の regions を確認してください。`);
  }
  if (probe.ok && to) {
    warnings.push("外部ドメイン宛のリレーまで検証しました。メールは送信していません（RSET で中断）。");
  }

  return NextResponse.json(
    {
      ok: probe.ok && warnings.length === 0,
      verdict: probe.ok
        ? warnings.length === 0
          ? "✅ 送信可能です（接続・認証・宛先受理まで確認）"
          : "⚠️ 送信はできますが設定に懸念があります"
        : "❌ 送信できません",
      environment: {
        vercelRegion: region,
        egressIp: egress.ip,
        egressCountry: egress.country,
        egressOrg: egress.org,
        nodeEnv: process.env.NODE_ENV ?? null,
        notifyTransport: process.env.NOTIFY_TRANSPORT ?? "smtp",
      },
      smtp: probe,
      warnings,
    },
    { status: probe.ok ? 200 : 503 },
  );
}
