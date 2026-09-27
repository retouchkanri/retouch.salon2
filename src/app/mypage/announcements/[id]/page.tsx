import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { messageBodyHtml } from "@/lib/memberMessages";
import MarkAnnouncementRead from "./MarkAnnouncementRead";

export const dynamic = "force-dynamic";

export default async function MemberAnnouncementDetailPage({ params }: { params: { id: string } }) {
  await requireMember();
  const supabase = createSupabaseServerClient();

  // RLS により、自分が対象でない／未配信のメッセージは取得できない
  const { data: message } = await supabase
    .from("member_messages")
    .select("id, title, body, body_format, tag, tag_color, sent_at, channel_inapp, status, image_urls, pdf_urls")
    .eq("id", params.id)
    .eq("channel_inapp", true)
    .eq("status", "sent")
    .maybeSingle();
  if (!message) notFound();
  const m = message as any;

  return (
    <div className="space-y-4">
      <MarkAnnouncementRead id={m.id} />
      <div className="flex items-center justify-between">
        <Link href="/mypage/announcements" className="text-brand underline">お知らせ一覧へ</Link>
        <span className="text-xs text-ink-mute">{formatDate(m.sent_at)}</span>
      </div>
      <article className="card space-y-3">
        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded ${m.tag_color}`}>{m.tag}</span>
        <h1 className="text-xl font-bold">{m.title}</h1>
        <div
          className="prose prose-sm max-w-none text-[15px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: messageBodyHtml(m.body ?? "", m.body_format) }}
        />
        {((m.image_urls as string[] | null) ?? []).filter(Boolean).map((url: string, i: number) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={url} alt={`添付画像 ${i + 1}`} className="w-full rounded-xl object-contain" />
        ))}
        {((m.pdf_urls as string[] | null) ?? []).filter(Boolean).length > 0 && (
          <div className="space-y-2">
            {((m.pdf_urls as string[]) ?? []).filter(Boolean).map((url: string, i: number) => (
              <div key={i} className="p-4 border border-surface-line rounded-xl bg-surface-soft flex items-center gap-3">
                <span className="text-2xl">📄</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-ink">
                    添付資料（PDF）{((m.pdf_urls as string[]) ?? []).length > 1 ? ` ${i + 1}` : ""}
                  </p>
                  <p className="text-xs text-ink-mute">クリックしてPDFを開く・ダウンロード</p>
                </div>
                <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2 !px-4 !text-sm shrink-0">
                  PDFを開く
                </a>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
