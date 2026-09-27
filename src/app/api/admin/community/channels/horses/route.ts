import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 支援者のいる馬ごとに「支援者チャンネル」（その馬を支援中の会員だけが参加できる公開チャンネル）を
 * まとめて作成する。同じ馬を対象にしたチャンネル、または同名のチャンネルが既にある馬は作らない。
 */
export async function POST() {
  const session = await requireCapability("community.manage");
  const admin = createSupabaseAdminClient();

  const [supports, teams, horses, channels] = await Promise.all([
    admin.from("support_subscriptions").select("horse_id").in("status", ["active", "past_due"]).limit(10000),
    admin.from("special_team_memberships").select("horse_id").in("status", ["active", "past_due"]).limit(10000),
    admin.from("horses").select("id, name, sort_order").order("sort_order"),
    admin.from("community_channels").select("name, audience, audience_horse_ids").eq("kind", "channel"),
  ]);
  const firstError = supports.error ?? teams.error ?? horses.error ?? channels.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const supported = new Set<string>(
    [...(supports.data ?? []), ...(teams.data ?? [])].map((r: any) => r.horse_id).filter(Boolean),
  );
  const existingNames = new Set((channels.data ?? []).map((c: any) => String(c.name ?? "").toLowerCase()));
  const coveredHorses = new Set<string>();
  for (const c of channels.data ?? []) {
    if ((c as any).audience === "supporters" && ((c as any).audience_horse_ids ?? []).length === 1) {
      coveredHorses.add((c as any).audience_horse_ids[0]);
    }
  }

  const rows = (horses.data ?? [])
    .filter((h: any) => supported.has(h.id) && !coveredHorses.has(h.id))
    .map((h: any, i: number) => ({ horse: h, name: `${h.name}の支援者`.slice(0, 60), i }))
    .filter((x) => !existingNames.has(x.name.toLowerCase()))
    .map((x) => ({
      kind: "channel",
      name: x.name,
      description: `${x.horse.name}を支援している会員のためのチャンネルです。近況の共有や応援メッセージをどうぞ。`,
      category: "supporters",
      visibility: "public",
      audience: "supporters",
      audience_horse_ids: [x.horse.id],
      audience_plan_codes: [],
      post_policy: "everyone",
      auto_join: true,
      is_required: false,
      sort_order: 200 + x.i,
      created_by: session.userId,
    }));

  if (rows.length > 0) {
    const { error } = await admin.from("community_channels").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAudit({
    actorId: session.userId,
    action: "community.channel_create_horses",
    targetTable: "community_channels",
    meta: { created: rows.length, names: rows.map((r) => r.name) },
  });
  return NextResponse.json({ ok: true, created: rows.length });
}
