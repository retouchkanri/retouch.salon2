import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import NewsForm from "./NewsForm";
import NewsDeleteButton from "./NewsDeleteButton";

export default async function NewsPage() {
  const supabase = createSupabaseServerClient();
  const { data: news } = await supabase
    .from("news")
    .select("*")
    .order("published_at", { ascending: false });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ニュース管理</h1>
      <NewsForm />
      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>タイトル</th>
              <th>タグ</th>
              <th>公開日</th>
              <th>公開</th>
              <th>公開範囲</th>
              <th>順序</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(news ?? []).map((n: any, i: number) => (
              <tr key={n.id}>
                <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                <td className="font-semibold max-w-xs truncate">{n.title}</td>
                <td>
                  <span className={`text-[10px] font-bold px-2 py-0.5 ${n.tag_color}`}>{n.tag}</span>
                </td>
                <td>{formatDate(n.published_at)}</td>
                <td>{n.is_published ? "公開" : "非公開"}</td>
                <td>{n.public_access === "members_only" ? "会員限定" : "全体公開"}</td>
                <td className="tabular-nums">{n.sort_order}</td>
                <td className="text-right space-x-2">
                  <a href={`/admin/news/${n.id}`} className="text-brand underline text-sm">編集</a>
                  <NewsDeleteButton id={n.id} title={n.title} />
                </td>
              </tr>
            ))}
            {(news ?? []).length === 0 && (
              <tr><td colSpan={8} className="text-center py-6 text-ink-mute">ニュースはまだありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
