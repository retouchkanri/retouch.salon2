import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { htmlToPlainText } from "@/lib/memberMessages";

export const dynamic = "force-dynamic";

export default async function MemberAnnouncementsPage() {
  const session = await requireMember();
  const supabase = createSupabaseServerClient();

  // RLS により「自分が対象 かつ アプリ内表示ON かつ 配信済み」のみ取得される
  const { data: messages } = await supabase
    .from("member_messages")
    .select("id, title, body, body_format, tag, tag_color, sent_at")
    .eq("channel_inapp", true)
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  // 既読状態（自分の配信先行）
  const readMap = new Map<string, string | null>();
  if (session.customerId) {
    const admin = createSupabaseAdminClient();
    const { data: recs } = await admin
      .from("member_message_recipients")
      .select("message_id, read_at")
      .eq("customer_id", session.customerId);
    for (const r of recs ?? []) readMap.set((r as any).message_id, (r as any).read_at);
  }

  const list = messages ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">お知らせ</h1>
        <Link href="/mypage" className="text-brand underline">マイページへ戻る</Link>
      </div>

      {list.length === 0 ? (
        <div className="card text-ink-mute">現在お知らせはありません。</div>
      ) : (
        <div className="space-y-3">
          {list.map((m: any) => {
            const unread = readMap.has(m.id) && !readMap.get(m.id);
            const preview =
              m.body_format === "text" ? m.body : htmlToPlainText(m.body ?? "");
            return (
              <Link key={m.id} href={`/mypage/announcements/${m.id}`} className="card block hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${m.tag_color}`}>{m.tag}</span>
                      {unread && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700">未読</span>}
                    </div>
                    <h3 className="font-semibold truncate">{m.title}</h3>
                    <p className="text-sm text-ink-mute line-clamp-2">{preview.slice(0, 120)}</p>
                  </div>
                  <span className="text-xs text-ink-mute whitespace-nowrap">{formatDate(m.sent_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
