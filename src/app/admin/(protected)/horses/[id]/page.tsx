import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import HorseEditForm from "./HorseEditForm";

export default async function EditHorsePage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("horses").select("*").eq("id", params.id).maybeSingle();
  if (!data) return notFound();
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">馬の編集</h1>
        <Link className="text-brand underline" href="/admin/horses">← 戻る</Link>
      </div>
      <HorseEditForm horse={data as any} />
    </div>
  );
}
