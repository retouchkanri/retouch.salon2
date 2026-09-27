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
