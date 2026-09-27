import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  full_name: z.string().min(1).max(120),
  full_name_kana: z.string().max(120).optional().nullable(),
  email: z
    .union([z.string().email(), z.literal(""), z.null()])
    .optional(),
  phone: z.string().max(40).optional().nullable(),
  birthday: z.string().optional().nullable(),
  gender: z.enum(["male", "female", "other", "unspecified"]).optional(),
  postal_code: z.string().max(20).optional().nullable(),
  address1: z.string().max(200).optional().nullable(),
  address2: z.string().max(200).optional().nullable(),
  status: z.enum(["active", "suspended", "withdrawn"]).default("active"),
});

export async function POST(req: Request) {
  const session = await requireCapability("customers.manage");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const email = parsed.data.email ? String(parsed.data.email) : null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("customers")
    .insert({
      full_name: parsed.data.full_name,
      full_name_kana: parsed.data.full_name_kana || null,
      email,
      phone: parsed.data.phone || null,
      birthday: parsed.data.birthday || null,
      gender: parsed.data.gender ?? "unspecified",
      postal_code: parsed.data.postal_code || null,
      address1: parsed.data.address1 || null,
      address2: parsed.data.address2 || null,
      status: parsed.data.status,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "customer.create",
    target_table: "customers",
    target_id: data.id,
  });
  return NextResponse.json({ ok: true, id: data.id });
}
