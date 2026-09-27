import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { customerIdsToUserIds } from "@/lib/community/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadPrivateChannel(id: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("community_channels")
    .select("id, name, kind, visibility")
    .eq("id", id)
    .maybeSingle();
  return { admin, channel: data };
}

/** 非公開チャンネルのメンバー一覧。 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const { admin, channel } = await loadPrivateChannel(params.id);
  if (!channel || channel.kind !== "channel") return NextResponse.json({ error: "チャンネルが見つかりません" }, { status: 404 });

  const { data: rows, error } = await admin
    .from("community_channel_members")
    .select("user_id, joined_at, last_read_at, hidden")
    .eq("channel_id", params.id)
    .order("joined_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (rows ?? []).filter((r: any) => !r.hidden).map((r: any) => r.user_id as string);

  const [{ data: customers }, { data: profiles }] = await Promise.all([
    ids.length ? admin.from("customers").select("auth_user_id, full_name, email").in("auth_user_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? admin.from("community_profiles").select("user_id, display_name").in("user_id", ids) : Promise.resolve({ data: [] as any[] }),
  ]);
  const cmap = new Map((customers ?? []).map((c: any) => [c.auth_user_id, c]));
  const pmap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
  const members = (rows ?? [])
    .filter((r: any) => !r.hidden)
    .map((r: any) => ({
      user_id: r.user_id,
      joined_at: r.joined_at,
      last_read_at: r.last_read_at,
      full_name: cmap.get(r.user_id)?.full_name ?? null,
      email: cmap.get(r.user_id)?.email ?? null,
      display_name: pmap.get(r.user_id)?.display_name ?? null,
    }));
  return NextResponse.json({ members });
}

const addSchema = z.object({ customer_ids: z.array(z.string().uuid()).min(1).max(500) });

/** 非公開チャンネルにメンバーを追加（顧客を指定）。 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "追加する会員を選択してください" }, { status: 400 });
  const { admin, channel } = await loadPrivateChannel(params.id);
  if (!channel || channel.kind !== "channel") return NextResponse.json({ error: "チャンネルが見つかりません" }, { status: 404 });
  if (channel.visibility !== "private") {
    return NextResponse.json({ error: "メンバーの追加は非公開チャンネルでのみ行えます" }, { status: 400 });
  }

  const userIds = await customerIdsToUserIds(admin, parsed.data.customer_ids);
  const skipped = parsed.data.customer_ids.length - userIds.length;
  if (userIds.length > 0) {
    const { error } = await admin
      .from("community_channel_members")
      .upsert(
        userIds.map((u) => ({ channel_id: params.id, user_id: u, hidden: false })),
        { onConflict: "channel_id,user_id" },
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "community.channel_members_add",
    targetTable: "community_channels",
    targetId: params.id,
    meta: { added: userIds.length, skipped_no_login: skipped },
  });
  return NextResponse.json({ ok: true, added: userIds.length, skipped });
}

const removeSchema = z.object({ user_id: z.string().uuid() });

/** 非公開チャンネルからメンバーを外す。 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const parsed = removeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  const { admin, channel } = await loadPrivateChannel(params.id);
  if (!channel || channel.kind !== "channel") return NextResponse.json({ error: "チャンネルが見つかりません" }, { status: 404 });

  const { error } = await admin
    .from("community_channel_members")
    .delete()
    .eq("channel_id", params.id)
    .eq("user_id", parsed.data.user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "community.channel_members_remove",
    targetTable: "community_channels",
    targetId: params.id,
    meta: { user_id: parsed.data.user_id },
  });
  return NextResponse.json({ ok: true });
}
