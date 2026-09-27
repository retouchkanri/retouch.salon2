/**
 * Create / promote an admin user.
 * Usage:
 *   npx tsx scripts/create-admin.ts <email> <password> [name]
 *
 * - Creates a Supabase auth user if missing.
 * - Upserts a profiles row with role = admin (linked to a customer row).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const [, , email, password, name] = process.argv;
  if (!email || !password) {
    console.error("Usage: tsx scripts/create-admin.ts <email> <password> [name]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !srv) throw new Error("Missing Supabase credentials");

  const admin = createClient(url, srv, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. Find or create auth user.
  const list = await admin.auth.admin.listUsers();
  let userId = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: name ?? "管理者" },
    });
    if (error) throw error;
    userId = data.user?.id;
    console.log(`Created auth user ${userId}`);
  } else {
    await admin.auth.admin.updateUserById(userId, { password });
    console.log(`Updated password for existing user ${userId}`);
  }

  if (!userId) throw new Error("No auth user id");

  // 2. Customer row.
  const { data: existing } = await admin.from("customers").select("id").eq("email", email).maybeSingle();
  let customerId: string | undefined = (existing as any)?.id;
  if (!customerId) {
    const { data, error } = await admin
      .from("customers")
      .insert({ full_name: name ?? "管理者", email, status: "active", auth_user_id: userId })
      .select("id")
      .single();
    if (error) throw error;
    customerId = (data as any).id;
    console.log(`Created customer ${customerId}`);
  } else {
    await admin.from("customers").update({ auth_user_id: userId, full_name: name ?? "管理者" }).eq("id", customerId);
  }

  // 3. Profile row promoted to admin.
  const { error } = await admin.from("profiles").upsert({
    id: userId, role: "admin", customer_id: customerId,
  });
  if (error) throw error;
  console.log(`OK. ${email} is now admin.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
