import { chatComplete } from "@/lib/openai";
import { getChatSettings } from "@/lib/chatbot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type HorseDraftInput = {
  name: string;
  profile: string | null;
  monthLabel: string;
  staffNote: string;
  units: number;
  supporters: number;
  deltaUnits: number;
  history: string;
};

function template(input: HorseDraftInput): { body: string; lifeStory: string } {
  const move = input.deltaUnits > 0 ? `${input.deltaUnits}口増えました` : input.deltaUnits < 0 ? `${Math.abs(input.deltaUnits)}口減りました` : "口数は先月と同じです";
  return {
    body: [
      `${input.monthLabel}の${input.name}です。いま ${input.supporters}名、${input.units}口の支援をいただいています。先月と比べて${move}。`,
      input.staffNote ? `スタッフからの近況: ${input.staffNote}` : "スタッフからの近況メモは、今月はまだ入っていません。",
      "いただいた支援は、預託先での飼養と日常の管理に使っています。",
    ].join("\n\n"),
    lifeStory: [
      input.profile ? `${input.name}について、記録されている紹介は次のとおりです。${input.profile}` : `${input.name}の保護当時の記録は、馬マスタの紹介文が空のため、まだ文章にしていません。`,
      input.history ? `支援の動き: ${input.history}` : "",
    ].filter(Boolean).join("\n\n"),
  };
}

/** キーが使えるときは文章を整え、使えないときは記録だけを並べた下書きを返す。 */
export async function draftHorseReport(input: HorseDraftInput): Promise<{ body: string; lifeStory: string; usedAi: boolean }> {
  const fallback = template(input);
  try {
    const settings = await getChatSettings(createSupabaseAdminClient());
    if (!settings.apiKey) return { ...fallback, usedAi: false };
    const raw = await chatComplete(
      [
        {
          role: "system",
          content: "あなたは引退馬の支援団体 Retouch の報告書を書く担当です。渡された事実だけを使い、温かく短い日本語で書いてください。病気や性格など、渡されていないことは書かないでください。JSONだけを返してください。",
        },
        {
          role: "user",
          content: `次の事実から、会員向けの今月の報告 body と、保護から今までの歩み lifeStory を書いてください。\n${JSON.stringify(input)}\n形式: {"body":"...","lifeStory":"..."}`,
        },
      ],
      { apiKey: settings.apiKey, model: settings.chatModel || "gpt-4o-mini", maxTokens: 900, temperature: 0.4 },
    );
    const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")) as { body?: string; lifeStory?: string };
    if (!json.body || !json.lifeStory) return { ...fallback, usedAi: false };
    return { body: json.body, lifeStory: json.lifeStory, usedAi: true };
  } catch {
    return { ...fallback, usedAi: false };
  }
}
