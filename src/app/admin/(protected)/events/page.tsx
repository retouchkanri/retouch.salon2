import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import EventForm from "./EventForm";

export default async function EventsPage() {
  const supabase = createSupabaseServerClient();
  const { data: events } = await supabase
    .from("events")
    .select("*")
    .order("sort_order", { ascending: false })
    .order("starts_at", { ascending: false });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">イベントマスタ</h1>
      <EventForm />
      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead><tr><th className="w-12 text-right">順</th><th>タイトル</th><th>種別</th><th>日時</th><th>定員</th><th>限定</th><th>公開</th><th></th></tr></thead>
          <tbody>
            {(events ?? []).map((e: any) => (
              <tr key={e.id}>
                <td className="text-right text-ink-mute tabular-nums">{e.sort_order ?? 0}</td>
                <td className="font-semibold">{e.title}</td>
                <td>{e.type === "private_visit" ? "個別見学" : "見学会"}</td>
                <td>{formatDate(e.starts_at, true)}</td>
                <td>{e.capacity}</td>
                <td>{e.supporters_only ? "支援者のみ" : "全員"}</td>
                <td>
                  <span className={e.is_published ? "chip-ok" : "chip-mute"}>
                    {e.is_published ? "公開" : "非公開"}
                  </span>
                </td>
                <td className="text-right">
                  <Link href={`/admin/events/${e.id}`} className="text-brand underline">編集</Link>
                </td>
              </tr>
            ))}
            {(events ?? []).length === 0 && (
              <tr><td colSpan={8} className="text-center py-6 text-ink-mute">イベントはまだありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
