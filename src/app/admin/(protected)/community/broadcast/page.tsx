import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { communityInstalled } from "@/lib/community/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import CommunityTabs from "../CommunityTabs";
import BroadcastForm from "./BroadcastForm";

export const dynamic = "force-dynamic";

export default async function CommunityBroadcastPage() {
  await requireCapability("community.manage");
  const admin = createSupabaseAdminClient();
  const installed = await communityInstalled(admin);
  if (!installed.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">コミュニティ管理：一括送信</h1>
        <p className="card text-sm">community.sql が未適用です。<Link href="/admin/community" className="text-brand underline ml-1">概要へ</Link></p>
      </div>
    );
  }
  const [{ data: horses }, reportsOpen] = await Promise.all([
    admin.from("horses").select("id, name").order("sort_order"),
    admin.from("community_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-2xl font-bold">コミュニティ管理：一括送信</h1>
      <CommunityTabs openReports={reportsOpen.count ?? 0} />
      <p className="text-sm text-ink-soft">
        条件に当てはまる会員それぞれに、あなたのアカウントからダイレクトメッセージ（個別チャット）を送ります。
        全員に同じ内容をチャンネルで伝える場合は、コミュニティの「お知らせ」チャンネルに投稿してください。
      </p>
      <BroadcastForm horses={(horses ?? []) as any[]} />
    </div>
  );
}
