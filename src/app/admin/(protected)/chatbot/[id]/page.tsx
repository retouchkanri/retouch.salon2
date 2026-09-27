import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import KbForm from "../KbForm";

export const dynamic = "force-dynamic";

export default async function KbEditPage({ params }: { params: { id: string } }) {
  await requireCapability("chatbot.manage");
  const admin = createSupabaseAdminClient();
  const { data: entry } = await admin
    .from("kb_entries")
    .select("id, title, content, category, is_active")
    .eq("id", params.id)
    .maybeSingle();
  if (!entry) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ナレッジ編集</h1>
        <Link href="/admin/chatbot" className="text-brand underline">一覧へ戻る</Link>
      </div>
      <KbForm initial={entry} id={(entry as any).id} />
    </div>
  );
}
