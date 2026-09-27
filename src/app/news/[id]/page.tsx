import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { NewsItem } from "@/types/db";

const BOOKINGS_PATH = "/mypage/bookings";

export const dynamic = "force-dynamic";

async function loadNews(id: string): Promise<NewsItem | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("news")
    .select("*")
    .eq("id", id)
    .eq("is_published", true)
    .maybeSingle();
  return (data as NewsItem | null) ?? null;
}

/** HTML タグを除去してプレーンテキストを返す（OGP description 用） */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const news = await loadNews(params.id);
  if (!news) return { title: "お知らせ" };
  const desc = news.body ? stripHtml(news.body).slice(0, 120) : undefined;
  return {
    title: `${news.title} — お知らせ`,
    description: desc,
  };
}

export default async function NewsDetailPage({ params }: { params: { id: string } }) {
  const [news, session] = await Promise.all([loadNews(params.id), getSession()]);
  if (!news) return notFound();

  const isEvent = news.tag === "イベント";
  const applyHref = session ? BOOKINGS_PATH : `/login?next=${BOOKINGS_PATH}`;

  /** 本文が HTML かどうか判定（<タグ で始まれば HTML、そうでなければ平文） */
  const isHtml = news.body?.trimStart().startsWith("<") ?? false;

  return (
    <main className="max-w-3xl mx-auto px-5 py-12">
      <Link href="/" className="text-brand underline text-sm">
        ← トップへ戻る
      </Link>

      <article className="mt-4 bg-white rounded-2xl shadow-sm overflow-hidden">
        {news.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={news.image_url} alt={news.title} className="w-full max-h-96 object-cover" />
        )}
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-4">
            <time className="text-sm text-ink-mute tabular-nums">
              {formatDate(news.published_at)}
            </time>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${news.tag_color}`}>
              {news.tag}
            </span>
          </div>

          <h1 className="text-2xl font-bold text-ink mb-5 leading-snug">{news.title}</h1>

          {/* 本文 */}
          {news.body && (
            isHtml ? (
              <div
                className="rich-text"
                dangerouslySetInnerHTML={{ __html: news.body }}
              />
            ) : (
              <div className="text-ink-soft leading-relaxed whitespace-pre-wrap">{news.body}</div>
            )
          )}

          {/* 本文追加画像 */}
          {((news as any).image_urls as string[] | null)?.filter(Boolean).map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt={`添付画像 ${i + 1}`} className="mt-4 w-full rounded-xl object-contain" />
          ))}

          {/* PDF 添付ダウンロード（複数対応） */}
          {(() => {
            const allPdfs: string[] = [];
            const legacyUrl = (news as any).pdf_url as string | null;
            const multiUrls = (news as any).pdf_urls as string[] | null;
            const multiNames = ((news as any).pdf_names as string[] | null) ?? [];
            if (Array.isArray(multiUrls) && multiUrls.length > 0) {
              allPdfs.push(...multiUrls.filter(Boolean));
            } else if (legacyUrl) {
              allPdfs.push(legacyUrl);
            }
            if (allPdfs.length === 0) return null;
            return (
              <div className="mt-6 space-y-2">
                {allPdfs.map((pdfUrl, i) => {
                  const label =
                    multiNames[i]?.trim() ||
                    `添付資料（PDF）${allPdfs.length > 1 ? ` ${i + 1}` : ""}`;
                  return (
                    <div key={i} className="p-4 border border-surface-line rounded-xl bg-surface-soft flex items-center gap-3">
                      <span className="text-2xl">📄</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{label}</p>
                        <p className="text-xs text-ink-mute">クリックしてPDFを開く・ダウンロード</p>
                      </div>
                      <a
                        href={pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary !py-2 !px-4 !text-sm shrink-0"
                      >
                        PDFを開く
                      </a>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {isEvent && (
            <div className="mt-6 pt-6 border-t border-surface-line text-center">
              <Link href={applyHref} className="btn-primary inline-flex">
                {session ? "予約・申し込みはこちら" : "ログインして申し込む"}
              </Link>
              {!session && (
                <p className="text-xs text-ink-mute mt-2">
                  会員登録がお済みでない方は
                  <Link href="/guide" className="text-brand underline mx-1">
                    新規会員登録
                  </Link>
                  からお手続きください。
                </p>
              )}
            </div>
          )}
        </div>
      </article>

      <div className="mt-8 text-center">
        <Link href="/" className="btn-ghost">
          トップへ戻る
        </Link>
      </div>
    </main>
  );
}
