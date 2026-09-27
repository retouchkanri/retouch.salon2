import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getChatSettings } from "@/lib/chatbot";
import { fetchAllRows } from "@/lib/fetchAll";
import ChatbotSettingsForm from "./ChatbotSettingsForm";
import KbForm from "./KbForm";
import KbDeleteButton from "./KbDeleteButton";
import ReindexButton from "./ReindexButton";

export const dynamic = "force-dynamic";

export default async function ChatbotAdminPage() {
  await requireCapability("chatbot.manage");
  const admin = createSupabaseAdminClient();

  // ナレッジ件数・埋め込み未生成件数をそのまま表示するため、.limit(200) や
  // PostgREST の 1000 行上限で切られないよう最後までページングする。
  const [settings, { rows: entries }] = await Promise.all([
    getChatSettings(admin),
    fetchAllRows<any>((from, to) =>
      admin
        .from("kb_entries")
        .select("id, title, category, is_active, embedding, updated_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const missingEmbeddings = entries.filter(
    (e: any) => e.is_active && !e.embedding,
  ).length;

  return (
    <div className="space-y-8 max-w-4xl">
      <h1 className="text-2xl font-bold">AIチャットボット</h1>

      {/* ── Status ── */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-lg">状態</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <span
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full font-medium ${
              settings.enabled && settings.apiKey
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-600"
            }`}
          >
            {settings.enabled && settings.apiKey ? "✓ AI有効" : "✗ AI無効"}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full font-medium ${
              settings.apiKey ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {settings.apiKey ? "✓ APIキー設定済み" : "✗ APIキー未設定"}
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full font-medium bg-surface-2 text-ink-mute">
            モデル: {settings.chatModel}
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full font-medium bg-surface-2 text-ink-mute">
            ナレッジ: {(entries ?? []).length} 件
          </span>
        </div>
        {!settings.apiKey && (
          <p className="text-sm text-red-600">
            Vercel（または .env.local）に <code className="bg-surface-2 px-1 rounded">OPENAI_API_KEY</code> を設定したうえで、
            下の「設定を保存」ボタンを押してください。DBにキーが登録されAIが有効になります。
          </p>
        )}
      </section>

      {/* ── Settings (system prompt + activate) ── */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">設定（システムプロンプト補足）</h2>
        <p className="text-sm text-ink-soft">
          「保存」すると環境変数の <code className="bg-surface-2 px-1 rounded">OPENAI_API_KEY</code> が
          DBに登録されAIが有効になります。下の補足欄は任意です。
        </p>
        <ChatbotSettingsForm initialPrompt={settings.systemPrompt ?? ""} />
      </section>

      {/* ── Knowledge base ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-lg">ナレッジベース（学習データ）</h2>
          {(entries ?? []).length > 0 && (
            <ReindexButton missingCount={missingEmbeddings} />
          )}
        </div>

        {missingEmbeddings > 0 && (
          <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
            埋め込み未生成のエントリが {missingEmbeddings} 件あります。
            「埋め込みを再生成」を押して学習させてください。
          </p>
        )}

        {/* Add new entry */}
        <div>
          <p className="text-sm text-ink-soft mb-2">新しいナレッジを追加</p>
          <KbForm />
        </div>

        {/* Entry list */}
        {(entries ?? []).length === 0 ? (
          <p className="text-sm text-ink-mute">まだナレッジがありません。上のフォームから追加してください。</p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-line text-ink-soft text-left">
                  <th className="px-4 py-2 font-medium">タイトル</th>
                  <th className="px-4 py-2 font-medium">カテゴリ</th>
                  <th className="px-4 py-2 font-medium text-center">学習</th>
                  <th className="px-4 py-2 font-medium text-center">有効</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-line">
                {(entries ?? []).map((e: any) => (
                  <tr key={e.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-2">
                      <Link href={`/admin/chatbot/${e.id}`} className="text-brand hover:underline font-medium">
                        {e.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{e.category}</td>
                    <td className="px-4 py-2 text-center">
                      {e.embedding ? (
                        <span className="text-green-600" title="埋め込み済み">✓</span>
                      ) : (
                        <span className="text-yellow-500" title="埋め込み未生成">–</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {e.is_active ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-ink-mute">✗</span>
                      )}
                    </td>
                    <td className="px-4 py-2 flex items-center gap-3 justify-end">
                      <Link href={`/admin/chatbot/${e.id}`} className="text-brand underline text-sm">
                        編集
                      </Link>
                      <KbDeleteButton id={e.id} title={e.title} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
