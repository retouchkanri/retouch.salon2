import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { writeAudit } from "@/lib/audit";

export async function PATCH(_: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("horse_meeting_requests")
    .select("id, customer_id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!row || row.customer_id !== session.customerId) {
    return NextResponse.json({ error: "申込が見つかりません" }, { status: 404 });
  }
  if (row.status === "canceled" || row.status === "completed") {
    return NextResponse.json({ error: "この申込は取消できません" }, { status: 400 });
  }
  const { error } = await admin
    .from("horse_meeting_requests")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: session.userId,
    action: "horse_meeting.cancel",
    targetTable: "horse_meeting_requests",
    targetId: params.id,
  });

  return NextResponse.json({ ok: true });
}
