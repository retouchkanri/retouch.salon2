import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatSettings } from "@/lib/chatbot";
import { speakJapanese } from "@/lib/openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  text: z.string().trim().min(1).max(800),
});

/** チャットの返答を、やわらかくゆっくりした日本人女性の声で読み上げる。 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const settings = await getChatSettings(createSupabaseAdminClient());
    if (!settings.apiKey) return NextResponse.json({ ok: false }, { status: 503 });
    const audio = await speakJapanese(parsed.data.text, settings.apiKey);
    return new NextResponse(audio, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
