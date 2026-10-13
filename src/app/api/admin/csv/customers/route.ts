import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { csvToObjects, toCsv } from "@/lib/csv";
import { MEMBERSHIP_COLUMNS, membershipColumns, type CustomerSummaryRow, type SupportDetailRow } from "@/lib/customerExport";
import { fetchAllRows } from "@/lib/fetchAll";

const EXPORT_COLUMNS = [
  "id","full_name","full_name_kana","email","phone",
  "postal_code","address1","address2","birthday","gender",
  "status","stripe_customer_id","joined_at",
];

export async function GET() {
  await requireCapability("csv");
  const admin = createSupabaseAdminClient();
  // PostgREST の 1000 行上限があるため .limit(10_000) は効かない。顧客は 1,200 件を
  // 超えており、ページングしないと 200 件以上が CSV から欠落する。
  // full_name は重複しうるのでページ境界を安定させるため id を第2キーにする。
  const [customers, summaries, supports] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      admin
        .from("customers")
        .select(EXPORT_COLUMNS.join(","))
        .order("full_name")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // 会員種別・特別参加・支援口数は、顧客一覧と同じ集計ビューから取る。
    fetchAllRows<CustomerSummaryRow>((from, to) =>
      admin
        .from("v_customer_summary")
        .select("customer_id, member_class_code, primary_plan_name, rpt_active, special_team_count, special_team_names, total_support_units")
        .order("customer_id", { ascending: true })
        .range(from, to),
    ),
    // 「誰に何口」。支援中と、決済失敗中（注記つきで出す）の行だけ。
    fetchAllRows<SupportDetailRow>((from, to) =>
      admin
        .from("support_subscriptions")
        .select("customer_id, horse_id, units, status, horse:horses(name, sort_order)")
        .in("status", ["active", "past_due"])
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  // どれかが読めなかったときは、空欄のまま出して「無料会員」に見せるより、出力をやめる。
  const error = customers.error ?? summaries.error ?? supports.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const summaryOf = new Map(summaries.rows.map((row) => [row.customer_id, row]));
  const supportsOf = new Map<string, SupportDetailRow[]>();
  for (const row of supports.rows) {
    const list = supportsOf.get(row.customer_id) ?? [];
    list.push(row);
    supportsOf.set(row.customer_id, list);
  }
  const rows = customers.rows.map((customer) => ({
    ...customer,
    ...membershipColumns(summaryOf.get(customer.id), supportsOf.get(customer.id) ?? []),
  }));

  const csv = toCsv(rows, [...EXPORT_COLUMNS, ...MEMBERSHIP_COLUMNS]);
  const bom = "\uFEFF";
  return new NextResponse(bom + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="customers_${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}

export async function POST(req: Request) {
  await requireCapability("csv");
  const fd = await req.formData();
  const file = fd.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "ファイルが添付されていません" }, { status: 400 });
  }
  const text = new TextDecoder("utf-8").decode(
    await (file as File).arrayBuffer(),
  ).replace(/^\uFEFF/, "");
  const rows = csvToObjects(text);
  if (rows.length === 0) return NextResponse.json({ error: "データがありません" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  let created = 0, updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const email = row.email?.trim() || null;
    const full_name = row.full_name?.trim();
    if (!full_name) { errors.push(`[skip] full_name 空: ${JSON.stringify(row)}`); continue; }

    const payload: any = {
      full_name,
      full_name_kana: row.full_name_kana || null,
      email,
      phone: row.phone || null,
      postal_code: row.postal_code || null,
      address1: row.address1 || null,
      address2: row.address2 || null,
      birthday: row.birthday || null,
      gender: row.gender && ["male","female","other","unspecified"].includes(row.gender) ? row.gender : "unspecified",
      status: row.status && ["active","suspended","withdrawn"].includes(row.status) ? row.status : "active",
      stripe_customer_id: row.stripe_customer_id || null,
    };

    let existing: { id: string } | null = null;
    if (row.id) {
      const r = await admin.from("customers").select("id").eq("id", row.id).maybeSingle();
      existing = (r.data as any) ?? null;
    }
    if (!existing && email) {
      const r = await admin.from("customers").select("id").eq("email", email).maybeSingle();
      existing = (r.data as any) ?? null;
    }

    if (existing) {
      const { error } = await admin.from("customers").update(payload).eq("id", existing.id);
      if (error) errors.push(`[update] ${email ?? full_name}: ${error.message}`);
      else updated += 1;
    } else {
      const { error } = await admin.from("customers").insert(payload);
      if (error) errors.push(`[create] ${email ?? full_name}: ${error.message}`);
      else created += 1;
    }
  }

  return NextResponse.json({ ok: true, created, updated, errors });
}
