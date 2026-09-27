import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import CommunityTabs from "../../CommunityTabs";
import ChannelForm, { EMPTY_CHANNEL } from "../ChannelForm";

export const dynamic = "force-dynamic";

export default async function NewCommunityChannelPage() {
  await requireCapability("community.manage");
  const admin = createSupabaseAdminClient();
  const { data: horses } = await admin.from("horses").select("id, name, is_supportable").order("sort_order");
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm">
        <Link href="/admin/community" className="text-brand underline">
          ← コミュニティ管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">チャンネルを作成</h1>
      <CommunityTabs />
      <ChannelForm channelId={null} initial={EMPTY_CHANNEL} horses={(horses ?? []) as any[]} />
    </div>
  );
}
