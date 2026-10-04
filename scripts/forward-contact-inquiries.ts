/**
 * 保存済みのお問い合わせのうち、info@retouch.salon へ届いていないものを転送する。
 * すでにその宛先へ送信済みのものは再送しない。
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { notify } from "../src/lib/notify";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const TARGET = "info@retouch.salon";

type InquiryMeta = {
  to?: string;
  name?: string | null;
  email?: string | null;
  subject?: string | null;
  preview?: string | null;
  sent?: boolean;
  source?: string | null;
  forwarded_from?: string | null;
  forwarded_to_info?: boolean;
};

function alreadyDelivered(meta: InquiryMeta): boolean {
  const to = meta.to ?? "";
  return meta.sent === true && to.split(",").map((item) => item.trim().toLowerCase()).includes(TARGET);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase credentials are missing");
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { error: kbError } = await admin
    .from("kb_entries")
    .update({
      content:
        "ご不明な点は、サイトのお問い合わせフォーム、または info@retouch.salon までご連絡ください。営業日に担当者からご返信します。",
    })
    .eq("title", "お問い合わせ");
  if (kbError) throw new Error(kbError.message);

  const { data, error } = await admin
    .from("audit_logs")
    .select("id, created_at, meta")
    .eq("action", "notify.contact_inquiry")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const pending = (data ?? []).filter((row) => {
    const meta = (row.meta ?? {}) as InquiryMeta;
    if (meta.source === "forwarded_to_info" || meta.forwarded_from || meta.forwarded_to_info) return false;
    return !alreadyDelivered(meta);
  });

  let sent = 0;
  let failed = 0;
  for (const row of pending) {
    const meta = (row.meta ?? {}) as InquiryMeta;
    const when = new Date(row.created_at as string).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const result = await notify({
      kind: "contact_inquiry",
      to: TARGET,
      subject: `【転送】${meta.subject || "お問い合わせフォーム"}`,
      reply_to: meta.email || undefined,
      body_text:
        `保存されていたお問い合わせを ${TARGET} へ転送します。\n\n` +
        `受付日時: ${when}\n` +
        `お名前　: ${meta.name || "（不明）"}\n` +
        `メール　: ${meta.email || "（不明）"}\n` +
        `件名　　: ${meta.subject || "（なし）"}\n` +
        `当時の宛先: ${meta.to || "（不明）"}\n\n` +
        `── 保存されていた内容 ──────────────\n` +
        `${meta.preview || "（本文の記録がありません）"}\n`,
      meta: {
        source: "forwarded_to_info",
        forwarded_from: row.id,
        name: meta.name ?? null,
        email: meta.email ?? null,
        subject: meta.subject ?? null,
      },
    });
    if (result.sent) sent += 1;
    else {
      failed += 1;
      console.error("forward failed", failed, result.error ?? "unknown");
      if (failed >= 3) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log(`pending ${pending.length} sent ${sent} failed ${failed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "forward failed");
  process.exit(1);
});
