import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth";
import { MEMBER_CODES, type MemberCode } from "@/lib/community/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import CommunityTabs from "../../CommunityTabs";
import ChannelForm, { type ChannelFormValue } from "../ChannelForm";
import ChannelMembers from "../ChannelMembers";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditCommunityChannelPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { created?: string };
}) {
  await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) notFound();
  const admin = createSupabaseAdminClient();
  const [{ data: ch }, { data: horses }] = await Promise.all([
    admin.from("community_channels").select("*").eq("id", params.id).eq("kind", "channel").maybeSingle(),
    admin.from("horses").select("id, name, is_supportable").order("sort_order"),
  ]);
  if (!ch) notFound();

  const initial: ChannelFormValue = {
    name: ch.name ?? "",
    description: ch.description ?? "",
    topic: ch.topic ?? "",
    category: ch.category,
    visibility: ch.visibility,
    audience: ch.audience,
    audience_plan_codes: ((ch.audience_plan_codes ?? []) as string[]).filter((c): c is MemberCode =>
      (MEMBER_CODES as readonly string[]).includes(c),
    ),
    audience_horse_ids: ch.audience_horse_ids ?? [],
    post_policy: ch.post_policy,
    auto_join: !!ch.auto_join,
    is_required: !!ch.is_required,
    sort_order: Number(ch.sort_order ?? 0),
    is_archived: !!ch.is_archived,
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm">
        <Link href="/admin/community" className="text-brand underline">
          ← コミュニティ管理
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold mr-auto">チャンネルを編集: {ch.name}</h1>
        <Link href={`/community?c=${ch.id}`} target="_blank" rel="noopener" className="btn-secondary !px-4 !py-2 text-sm">
          コミュニティで開く ↗
        </Link>
      </div>
      <CommunityTabs />
      {searchParams.created === "1" && (
        <p className="rounded bg-green-50 border border-green-200 text-green-800 px-4 py-2 text-sm">
          チャンネルを作成しました。
          {ch.visibility === "private" && "下の「メンバー」欄から参加者を追加してください。"}
        </p>
      )}
      <ChannelForm channelId={ch.id} initial={initial} horses={(horses ?? []) as any[]} />
      {ch.visibility === "private" && <ChannelMembers channelId={ch.id} />}
    </div>
  );
}
