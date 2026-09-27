import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { generateKbEmbedding, getChatSettings } from "@/lib/chatbot";

export const maxDuration = 60;

/**
 * ナレッジの埋め込みを生成（再インデックス）。
 *   既定: 埋め込み未生成（embedding is null）の有効エントリのみ
 *   ?all=1: 全有効エントリを再生成
 * APIキー設定後や初期ナレッジ投入後に実行する。時間内に処理し切れない分は
 * 再実行で続きを処理する。
 */
export async function POST(req: Request) {
  const session = await requireCapability("chatbot.manage");
  const admin = createSupabaseAdminClient();

  const settings = await getChatSettings(admin);
  if (!settings.apiKey) {
    return NextResponse.json({ error: "OpenAI APIキーが未設定です。先に設定してください。" }, { status: 400 });
  }

  const all = new URL(req.url).searchParams.get("all") === "1";
  let query = admin
    .from("kb_entries")
    .select("id, title, content")
    .eq("is_active", true)
    .limit(200);
  if (!all) query = query.is("embedding", null);
  const { data: entries, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const start = Date.now();
  let done = 0;
  let failed = 0;
  for (const e of entries ?? []) {
    if (Date.now() - start > 50_000) break; // 時間バジェット
    const vec = await generateKbEmbedding(settings, (e as any).title, (e as any).content);
    if (!vec) {
      failed++;
      continue;
    }
    const { error: upErr } = await admin
      .from("kb_entries")
      .update({ embedding: vec })
      .eq("id", (e as any).id);
    if (upErr) failed++;
    else done++;
  }

  await writeAudit({
    actorId: session.userId,
    action: "kb.reindex",
    targetTable: "kb_entries",
    meta: { done, failed, total: entries?.length ?? 0, all },
  });

  return NextResponse.json({ ok: true, done, failed, total: entries?.length ?? 0 });
}
