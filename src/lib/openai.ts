/**
 * OpenAI REST クライアント（依存追加なし・fetch のみ）。
 * APIキーは app_settings（DB）または環境変数 OPENAI_API_KEY から取得する。
 */

const OPENAI_BASE = "https://api.openai.com/v1";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** pgvector へ渡す埋め込みリテラル文字列 '[0.1,0.2,...]' を作る。 */
export function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** テキストを埋め込みベクトルに変換する。 */
export async function embedText(
  text: string,
  opts: { apiKey: string; model: string },
): Promise<number[]> {
  const res = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: opts.model, input: text.slice(0, 8000) }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`openai embeddings ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  const vec = j?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("openai embeddings: invalid response");
  return vec as number[];
}

/** チャット補完を実行し、本文テキストを返す。 */
export async function chatComplete(
  messages: ChatMessage[],
  opts: { apiKey: string; model: string; maxTokens?: number; temperature?: number },
): Promise<string> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens ?? 600,
      temperature: opts.temperature ?? 0.3,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`openai chat ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("openai chat: invalid response");
  return content.trim();
}

/**
 * 日本人女性の人事担当のような、やわらかくゆっくりした声で読み上げ、mp3 を返す。
 * 速度は 1 より遅くする（0.8）。
 */
export async function speakJapanese(text: string, apiKey: string): Promise<ArrayBuffer> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, 800);
  const instructions =
    "話者は日本人の女性だけです。男性、子ども、ニュースのアナウンサーの声にはしないでください。" +
    "大阪の事務所で応募者を迎える人事担当者のように、やわらかく低すぎない声で、人に語りかけてください。" +
    "速度はゆっくりです。文の区切りで少し間を置き、語尾を上げ下げして自然な抑揚をつけてください。" +
    "丁寧な共通語を土台に、関西の事務所で話すようなやわらかい話し言葉の調子を軽く交えてください。" +
    "強い方言やお笑いの口調、棒読みは使わないでください。";
  const attempts = [
    { model: "gpt-4o-mini-tts", voice: "shimmer", instructions, speed: 0.8 },
    { model: "gpt-4o-mini-tts", voice: "coral", instructions, speed: 0.8 },
    { model: "tts-1", voice: "nova", speed: 0.8 },
  ];
  let last = "openai speech failed";
  for (const attempt of attempts) {
    const res = await fetch(`${OPENAI_BASE}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: attempt.model,
        voice: attempt.voice,
        input,
        response_format: "mp3",
        speed: attempt.speed,
        ...(attempt.instructions ? { instructions: attempt.instructions } : {}),
      }),
    });
    if (res.ok) return res.arrayBuffer();
    last = `openai speech ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
  }
  throw new Error(last);
}
