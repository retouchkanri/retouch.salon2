import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { SETTING_KEYS } from "@/lib/chatbot";

const schema = z.object({
  system_prompt: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const session = await requireCapability("chatbot.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }

  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (!envKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が環境変数に設定されていません（Vercel の環境変数を確認してください）。" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const rows: { key: string; value: string | null }[] = [
    { key: SETTING_KEYS.apiKey, value: envKey },
    { key: SETTING_KEYS.enabled, value: "true" },
  ];
  if (parsed.data.system_prompt !== undefined) {
    rows.push({ key: SETTING_KEYS.systemPrompt, value: parsed.data.system_prompt || null });
  }

  for (const r of rows) {
    const { error } = await admin
      .from("app_settings")
      .upsert(
        { key: r.key, value: r.value, updated_by: session.userId, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "setting.chatbot_update",
    targetTable: "app_settings",
    meta: {
      updated_keys: rows.map((r) => r.key),
      api_key_synced_from_env: true,
    },
  });

  return NextResponse.json({ ok: true });
}
