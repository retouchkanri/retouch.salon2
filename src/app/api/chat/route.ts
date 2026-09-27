import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { answerQuestion } from "@/lib/chatbot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  question: z.string().trim().min(1, "質問を入力してください").max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(12)
    .optional(),
});

/**
 * 公開チャットエンドポイント（サイト訪問者・会員が利用）。
 * ナレッジベースを検索し、OpenAI で回答を生成して返す。
 * 未設定・無効・エラー時は fallback=true を返し、フロント側の簡易応答に委ねる。
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "入力が不正です", fallback: true },
      { status: 400 },
    );
  }

  try {
    const admin = createSupabaseAdminClient();
    const result = await answerQuestion(admin, {
      question: parsed.data.question,
      history: parsed.data.history,
    });
    return NextResponse.json({ ok: true, answer: result.answer, sources: result.sources });
  } catch (e: any) {
    const reason = e?.message ?? "unknown";
    // 未設定（chatbot not configured）や OpenAI エラー時はフロントの簡易応答へ。
    if (process.env.NODE_ENV === "development") {
      console.warn("[chat] falling back:", reason);
    }
    return NextResponse.json({ ok: false, fallback: true });
  }
}
