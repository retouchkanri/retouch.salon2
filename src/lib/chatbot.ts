import type { SupabaseClient } from "@supabase/supabase-js";
import { type ChatMessage, chatComplete, embedText } from "./openai";

/**
 * AIチャットボット（OpenAI + RAG）の中核。
 * 設定は app_settings（DB）から読み、APIキーは環境変数 OPENAI_API_KEY を
 * フォールバックに使う。ナレッジ検索は埋め込み（pgvector）を優先し、失敗時は
 * キーワード（ILIKE）検索にフォールバックする。
 */

export const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export const SETTING_KEYS = {
  apiKey: "openai_api_key",
  chatModel: "chat_model",
  embeddingModel: "embedding_model",
  enabled: "chat_enabled",
  systemPrompt: "chat_system_prompt",
} as const;

export type ChatSettings = {
  apiKey: string | null;
  chatModel: string;
  embeddingModel: string;
  enabled: boolean;
  systemPrompt: string | null;
};

// システム全体を説明するベースプロンプト（ナレッジが無くても一定の回答ができる）。
const BASE_SYSTEM_PROMPT = `あなたは「Retouchメンバーズサイト」のカスタマーサポートAI「リタッチ・サポート」です。
このサイトは引退競走馬（引退馬）を支援する会員制サービスです。
主な機能: 無料の会員登録、会員種別（A/B/C会員など）、馬ごとの「一口支援」、単発寄付、
牧場見学会の予約、支援会員限定の「馬の面会」、マイページでの各種確認、メールマガジン配信設定。

性格・話し方:
- 引退馬と利用者をあたたかく見守る、親しみやすく明るいサポート役です。
- 利用者に寄り添い、安心感のある言葉づかいで、丁寧でやわらかい敬語で話します。
- 文頭で軽く共感やお礼を伝え（例:「ご質問ありがとうございます」）、堅すぎない自然な日本語で答えます。
- 適度に絵文字（🐴 など）を1つ程度添えても構いませんが、使いすぎないでください。

回答ルール:
- 必ず日本語で回答し、要点が伝わるよう簡潔にまとめてください（長くなりすぎないこと）。
- 下記「参考情報」（ナレッジベース）を最優先の根拠とし、そこに無いことを推測で断定しないでください。
- 参考情報や会話から判断できない場合は、わかる範囲を案内したうえで「詳しくは運営事務局へお問い合わせください」とやさしくご案内してください。
- 金額・日程・在籍状況など変わりうる情報は「最新はマイページ／事務局でご確認ください」と添えてください。
- このサイト・引退馬支援と無関係な質問には、申し訳ない気持ちを示しつつサポート対象外である旨を丁寧にお伝えしてください。
- 最後に、必要に応じて次のご案内（関連するページや次の一歩）を一言添えると親切です。`;

export async function getChatSettings(admin: SupabaseClient): Promise<ChatSettings> {
  const { data } = await admin.from("app_settings").select("key, value");
  const map = new Map<string, string | null>();
  for (const row of data ?? []) map.set((row as any).key, (row as any).value);

  const apiKey =
    (map.get(SETTING_KEYS.apiKey) || "").trim() || process.env.OPENAI_API_KEY || null;
  const chatModel = (map.get(SETTING_KEYS.chatModel) || "").trim() || DEFAULT_CHAT_MODEL;
  const embeddingModel =
    (map.get(SETTING_KEYS.embeddingModel) || "").trim() || DEFAULT_EMBEDDING_MODEL;
  // enabled: 明示的に 'false' のときのみ無効。未設定なら（キーがあれば）有効。
  const enabledRaw = map.get(SETTING_KEYS.enabled);
  const enabled = enabledRaw == null ? Boolean(apiKey) : enabledRaw !== "false";
  const systemPrompt = (map.get(SETTING_KEYS.systemPrompt) || "").trim() || null;

  return { apiKey: apiKey || null, chatModel, embeddingModel, enabled, systemPrompt };
}

/**
 * KBエントリの埋め込みベクトル（number[]）を生成する。
 * APIキー未設定や失敗時は null（埋め込み無し＝キーワード検索対象）。
 * Supabase の pgvector カラムへは number[] をそのまま渡せる。
 */
export async function generateKbEmbedding(
  settings: ChatSettings,
  title: string,
  content: string,
): Promise<number[] | null> {
  if (!settings.apiKey) return null;
  try {
    return await embedText(`${title}\n\n${content}`, {
      apiKey: settings.apiKey,
      model: settings.embeddingModel,
    });
  } catch {
    return null;
  }
}

export type KbHit = { title: string; content: string; category: string; similarity?: number };

/**
 * 質問に関連するナレッジを検索する。
 *  1. 埋め込み + pgvector（match_kb_entries）で意味検索
 *  2. 失敗時は ILIKE キーワード検索にフォールバック
 */
export async function searchKnowledge(
  admin: SupabaseClient,
  question: string,
  settings: ChatSettings,
  matchCount = 5,
): Promise<KbHit[]> {
  // 1. 意味検索
  if (settings.apiKey) {
    try {
      const embedding = await embedText(question, {
        apiKey: settings.apiKey,
        model: settings.embeddingModel,
      });
      const { data, error } = await admin.rpc("match_kb_entries", {
        query_embedding: embedding,
        match_count: matchCount,
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        return (data as any[]).map((r) => ({
          title: r.title,
          content: r.content,
          category: r.category,
          similarity: r.similarity,
        }));
      }
    } catch {
      // フォールバックへ
    }
  }

  // 2. キーワード検索（埋め込み未生成 or 失敗時）
  const term = question.replace(/[%_]/g, (m) => `\\${m}`).slice(0, 100);
  const { data: kw } = await admin
    .from("kb_entries")
    .select("title, content, category")
    .eq("is_active", true)
    .or(`title.ilike.%${term}%,content.ilike.%${term}%`)
    .limit(matchCount);
  if (kw && kw.length > 0) {
    return (kw as any[]).map((r) => ({ title: r.title, content: r.content, category: r.category }));
  }

  // 何も当たらない場合は、有効なエントリの先頭を一般情報として渡す
  const { data: fallbackRows } = await admin
    .from("kb_entries")
    .select("title, content, category")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(matchCount);
  return (
    (fallbackRows as any[] | null)?.map((r) => ({
      title: r.title,
      content: r.content,
      category: r.category,
    })) ?? []
  );
}

export function buildChatMessages(params: {
  question: string;
  history: ChatMessage[];
  knowledge: KbHit[];
  settings: ChatSettings;
}): ChatMessage[] {
  const { question, history, knowledge, settings } = params;
  // 基本指示（役割・口調・回答ルール）は常に適用する。管理画面で設定された
  // システムプロンプトは「上書き」ではなく「補足」として末尾に追記する。
  // これにより、管理者が補足欄にURLやメモだけを入れても基本動作が壊れない。
  const extra = (settings.systemPrompt || "").trim();
  const extraBlock = extra ? `\n\n=== 運営からの補足指示・情報 ===\n${extra}` : "";
  const kbText =
    knowledge.length > 0
      ? knowledge.map((k, i) => `【${i + 1}. ${k.title}（${k.category}）】\n${k.content}`).join("\n\n")
      : "（該当するナレッジは見つかりませんでした）";

  const system: ChatMessage = {
    role: "system",
    content: `${BASE_SYSTEM_PROMPT}${extraBlock}\n\n=== 参考情報（ナレッジベース） ===\n${kbText}`,
  };

  // 直近の会話のみ（コスト・トークン節約のため最大6往復程度）
  const trimmedHistory = history.slice(-8);
  return [system, ...trimmedHistory, { role: "user", content: question }];
}

export async function answerQuestion(
  admin: SupabaseClient,
  params: { question: string; history?: ChatMessage[] },
): Promise<{ answer: string; sources: string[]; model: string }> {
  const settings = await getChatSettings(admin);
  if (!settings.enabled || !settings.apiKey) {
    throw new Error("chatbot not configured");
  }
  const knowledge = await searchKnowledge(admin, params.question, settings);
  const messages = buildChatMessages({
    question: params.question,
    history: params.history ?? [],
    knowledge,
    settings,
  });
  const answer = await chatComplete(messages, {
    apiKey: settings.apiKey,
    model: settings.chatModel,
  });
  return { answer, sources: knowledge.map((k) => k.title), model: settings.chatModel };
}
