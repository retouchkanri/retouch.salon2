import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { customerIdsToUserIds, ensureStaffProfile, toUuidList } from "@/lib/community/admin";
import { MEMBER_CODES, MESSAGE_MAX_LENGTH } from "@/lib/community/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 数百人への個別送信を1回の DB 関数で行う（2026-09 時点の会員数で数秒）。
export const maxDuration = 60;

const schema = z
  .object({
    mode: z.enum(["audience", "users"]),
    audience: z.enum(["all", "plans", "supporters"]).default("all"),
    plan_codes: z.array(z.enum(MEMBER_CODES)).default([]),
    horse_ids: z.array(z.string().uuid()).max(500).default([]),
    customer_ids: z.array(z.string().uuid()).max(1000).default([]),
    body: z.string().max(MESSAGE_MAX_LENGTH).default(""),
    preview: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "audience" && v.audience === "plans" && v.plan_codes.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "会員種別を1つ以上選択してください" });
    }
    if (v.mode === "users" && v.customer_ids.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "送信先の会員を選択してください" });
    }
    if (!v.preview && v.body.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "メッセージを入力してください" });
    }
  });

/**
 * 運営から会員へ、ダイレクトメッセージを一括で個別送信する（メール配信の置き換え）。
 * preview: true のときは送信せずに対象人数だけを返す。
 */
export async function POST(req: Request) {
  const session = await requireCapability("community.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const v = parsed.data;
  const admin = createSupabaseAdminClient();

  let recipients: string[];
  try {
    if (v.mode === "audience") {
      const { data, error } = await admin.rpc("community_audience_users", {
        p_audience: v.audience,
        p_codes: v.audience === "plans" ? v.plan_codes : [],
        p_horses: v.audience === "supporters" ? v.horse_ids : [],
      });
      if (error) throw new Error(error.message);
      recipients = toUuidList(data);
    } else {
      recipients = await customerIdsToUserIds(admin, v.customer_ids);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "対象者を取得できませんでした" }, { status: 500 });
  }
  recipients = Array.from(new Set(recipients.filter((id) => id !== session.userId)));

  if (v.preview) return NextResponse.json({ ok: true, count: recipients.length });
  if (recipients.length === 0) return NextResponse.json({ error: "送信対象の会員がいません" }, { status: 400 });

  await ensureStaffProfile(admin, session.userId);
  const { data: sent, error } = await admin.rpc("community_bulk_dm", {
    p_sender: session.userId,
    p_recipients: recipients,
    p_body: v.body.trim(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "community.broadcast",
    targetTable: "community_messages",
    meta: {
      mode: v.mode,
      audience: v.mode === "audience" ? v.audience : null,
      plan_codes: v.plan_codes,
      horse_ids: v.horse_ids,
      recipients: recipients.length,
      sent: Number(sent ?? 0),
      body_preview: v.body.trim().slice(0, 100),
    },
  });
  return NextResponse.json({ ok: true, sent: Number(sent ?? 0), count: recipients.length });
}
