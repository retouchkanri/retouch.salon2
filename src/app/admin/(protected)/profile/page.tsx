import { requireAdmin } from "@/lib/auth";
import { resolveAvatarUrl } from "@/lib/avatars";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import AdminProfileForm from "./AdminProfileForm";

export default async function AdminProfilePage() {
  const session = await requireAdmin();
  const admin = createSupabaseAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("*")
    .eq("auth_user_id", session.userId)
    .maybeSingle();

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold">マイプロフィール</h1>
      <AdminProfileForm
        userId={session.userId}
        email={session.email ?? ""}
        avatarUrl={resolveAvatarUrl(session.role, customer?.avatar_url ?? null)}
        fullName={customer?.full_name ?? ""}
        fullNameKana={customer?.full_name_kana ?? ""}
        phone={customer?.phone ?? ""}
      />
    </div>
  );
}
