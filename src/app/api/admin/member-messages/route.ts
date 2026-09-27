import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getBaseUrl } from "@/lib/site";
import { sendMemberMessage, AUDIENCE_VALUES } from "@/lib/memberMessages";

export const maxDuration = 60;
// 送信元IPを日本国内に固定する（Xserver の国外IPアクセス制限対策）。vercel.json と揃えること。
export const preferredRegion = "hnd1";

/**
 * 「作成＋今すぐ配信」の初回応答で使う送信時間バジェット（ms）。
 * 短く返すことで管理画面が全体件数を受け取り、進捗バーを早く表示できる。
 * 残件はクライアントが /send を繰り返し呼んで送り切る。
 */
const INITIAL_SEND_BUDGET_MS = 5_000;

const schema = z
  .object({
    title: z.string().trim().min(1, "件名を入力してください").max(200),
    body: z.string().max(50_000).default(""),
    body_format: z.enum(["html", "text"]).default("html"),
    tag: z.string().min(1).max(30).default("お知らせ"),
    tag_color: z.string().max(100).default("bg-brand-50 text-brand-dark"),
    channel_inapp: z.boolean().default(true),
    channel_email: z.boolean().default(false),
    audiences: z.array(z.enum(AUDIENCE_VALUES)).min(1, "配信対象を1つ以上選択してください"),
    target_customer_ids: z.array(z.string().uuid()).default([]),
    image_urls: z.array(z.string().url()).default([]),
    pdf_urls: z.array(z.string().url()).default([]),
    scheduled_at: z.string().optional().nullable(),
    // draft=下書き保存 / schedule=予約 / send=即時配信
    action: z.enum(["draft", "schedule", "send"]).default("draft"),
  })
  .refine((d) => d.channel_inapp || d.channel_email, {
    message: "配信チャネルを1つ以上選択してください",
    path: ["channel_inapp"],
  })
  .refine((d) => !d.audiences.includes("subset") || d.target_customer_ids.length > 0, {
    message: "配信対象の会員を選択してください",
    path: ["target_customer_ids"],
  })
  .refine((d) => d.action !== "schedule" || Boolean(d.scheduled_at), {
    message: "予約配信日時を指定してください",
    path: ["scheduled_at"],
  });

export async function POST(req: Request) {
  const session = await requireCapability("messages.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  let scheduledAtIso: string | null = null;
  if (d.action === "schedule" && d.scheduled_at) {
    const dt = new Date(d.scheduled_at);
    if (Number.isNaN(dt.getTime())) {
      return NextResponse.json({ error: "予約日時の形式が不正です" }, { status: 400 });
    }
    scheduledAtIso = dt.toISOString();
  }

  const status = d.action === "schedule" ? "scheduled" : "draft";

  const admin = createSupabaseAdminClient();
  const { data: inserted, error } = await admin
    .from("member_messages")
    .insert({
      title: d.title,
      body: d.body,
      body_format: d.body_format,
      tag: d.tag,
      tag_color: d.tag_color,
      channel_inapp: d.channel_inapp,
      channel_email: d.channel_email,
      // audience（単一値）は後方互換のため先頭の選択値を保持。実際の配信対象解決は audiences を使う。
      audience: d.audiences[0],
      audiences: d.audiences,
      target_customer_ids: d.audiences.includes("subset") ? d.target_customer_ids : [],
      image_urls: d.image_urls,
      pdf_urls: d.pdf_urls,
      status,
      scheduled_at: scheduledAtIso,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? "登録に失敗しました" }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: `message.${d.action === "send" ? "send" : d.action === "schedule" ? "schedule" : "create"}`,
    targetTable: "member_messages",
    targetId: inserted.id,
    meta: { title: d.title, audiences: d.audiences, channel_email: d.channel_email, action: d.action },
  });

  // 即時配信。
  // ここでは最初の1バッチだけを短時間で送って返す。目的は2つ:
  //   1. 配信対象の materialize と status='sending' への遷移をサーバ側で確定させる
  //      （この直後にブラウザが閉じられても cron が続きを送れる）。
  //   2. 全体件数（recipient_count）を早くクライアントへ返し、進捗バーを表示させる。
  // 残りはクライアントが /send を繰り返し呼び出して送り切る（進捗バーを更新しながら）。
  if (d.action === "send") {
    const result = await sendMemberMessage(admin, inserted.id, {
      baseUrl: getBaseUrl(req),
      budgetMs: INITIAL_SEND_BUDGET_MS,
    });
    return NextResponse.json({ ok: true, id: inserted.id, result });
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
