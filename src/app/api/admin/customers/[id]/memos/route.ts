import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  slot: z.number().int().min(1).max(3),
  body: z.string().max(4000).default(""),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireCapability("customers.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "入力が不正です" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("admin_memos").upsert(
    {
      customer_id: params.id,
      slot: parsed.data.slot,
      body: parsed.data.body,
      updated_by: session.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "customer_id,slot" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
