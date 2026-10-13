import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { customerIdsToUserIds } from "@/lib/community/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function loadChannel(id: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("community_channels")
    .select("id, name, kind, visibility")
    .eq("id", id)
    .maybeSingle();
  return { admin, channel: data };
}

/** 一覧に出す氏名・メール・表示名を付ける。 */
async function withNames<T extends { user_id: string }>(admin: Admin, rows: T[]) {
  const ids = rows.map((r) => r.user_id);
  const [{ data: customers }, { data: profiles }] = await Promise.all([
    ids.length ? admin.from("customers").select("auth_user_id, full_name, email").in("auth_user_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? admin.from("community_profiles").select("user_id, display_name").in("user_id", ids) : Promise.resolve({ data: [] as any[] }),
  ]);
  const cmap = new Map((customers ?? []).map((c: any) => [c.auth_user_id, c]));
  const pmap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
  return rows.map((r) => ({
    ...r,
    full_name: (cmap.get(r.user_id)?.full_name as string | undefined) ?? null,
    email: (cmap.get(r.user_id)?.email as string | undefined) ?? null,
    display_name: (pmap.get(r.user_id)?.display_name as string | undefined) ?? null,
  }));
}

/**
 * チャンネルのメンバー。
 *   非公開チャンネル: メンバーの一覧（members）。
 *   公開チャンネル: 対象者は自動で参加するので、運営が手動で追加・削除した会員だけ（overrides）。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const { admin, channel } = await loadChannel(params.id);
  if (!channel || channel.kind !== "channel") return NextResponse.json({ error: "チャンネルが見つかりません" }, { status: 404 });

  const { data: rows, error } = await admin
    .from("community_channel_members")
    .select("user_id, joined_at, last_read_at, hidden, access")
    .eq("channel_id", params.id)
    .order("joined_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (channel.visibility === "private") {
    const members = await withNames(
      admin,
      (rows ?? [])
        .filter((r: any) => !r.hidden && r.access !== "removed")
        .map((r: any) => ({ user_id: r.user_id as string, joined_at: r.joined_at as string, last_read_at: r.last_read_at as string | null })),
    );
    return NextResponse.json({ members, overrides: [] });
  }
  const overrides = await withNames(
    admin,
    (rows ?? [])
      .filter((r: any) => r.access === "granted" || r.access === "removed")
      .map((r: any) => ({ user_id: r.user_id as string, access: r.access as "granted" | "removed", joined_at: r.joined_at as string })),
  );
  return NextResponse.json({ members: [], overrides });
}

const changeSchema = z
  .object({
    customer_ids: z.array(z.string().uuid()).max(500).default([]),
    // 一覧の行から操作するとき（顧客ではなくログイン用のユーザーIDで指定）
    user_ids: z.array(z.string().uuid()).max(500).default([]),
    // add = 追加 / remove = 外す / reset = 手動の指定を取り消す（対象者の規則どおりに戻す）
    action: z.enum(["add", "remove", "reset"]).default("add"),
  })
  .refine((v) => v.customer_ids.length + v.user_ids.length > 0);

/** メンバーを追加する・外す・手動の指定を取り消す（どのチャンネルでも使える）。 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const parsed = changeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "会員を選択してください" }, { status: 400 });
  const { admin, channel } = await loadChannel(params.id);
  if (!channel || channel.kind !== "channel") return NextResponse.json({ error: "チャンネルが見つかりません" }, { status: 404 });

  const { action } = parsed.data;
  const fromCustomers = await customerIdsToUserIds(admin, parsed.data.customer_ids);
  const skipped = parsed.data.customer_ids.length - fromCustomers.length;
  const userIds = Array.from(new Set([...fromCustomers, ...parsed.data.user_ids]));
  let changed = 0;
  if (userIds.length > 0) {
    // 追加・削除の規則は DB の関数にまとめてある（コミュニティの画面からの操作と同じ結果になる）
    const { data, error } = await admin.rpc("community_admin_set_members", {
      p_channel: params.id,
      p_users: userIds,
      p_action: action,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    changed = Number(data ?? 0) || 0;
  }

  await writeAudit({
    actorId: session.userId,
    action: `community.channel_members_${action}`,
    targetTable: "community_channels",
    targetId: params.id,
    meta: { requested: userIds.length, changed, skipped_no_login: skipped },
  });
  return NextResponse.json({ ok: true, action, changed, added: changed, unchanged: userIds.length - changed, skipped });
}

const removeSchema = z.object({ user_id: z.string().uuid() });

/** メンバーを 1人外す（公開チャンネルでは「運営が外した会員」として記録し、本人は自分では戻れない）。 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("community.manage");
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  const parsed = removeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  const { admin, channel } = await loadChannel(params.id);
  if (!channel || channel.kind !== "channel") return NextResponse.json({ error: "チャンネルが見つかりません" }, { status: 404 });

  const { error } = await admin.rpc("community_admin_set_members", {
    p_channel: params.id,
    p_users: [parsed.data.user_id],
    p_action: "remove",
  });
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
