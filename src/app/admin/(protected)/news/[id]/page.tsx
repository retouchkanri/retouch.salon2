import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import NewsForm from "../NewsForm";

export default async function EditNewsPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: item } = await supabase
    .from("news")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!item) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/news" className="text-brand underline text-sm">&larr; ニュース一覧</Link>
        <h1 className="text-2xl font-bold">ニュース編集</h1>
      </div>
      <NewsForm initial={item} id={item.id} />
    </div>
  );
}
