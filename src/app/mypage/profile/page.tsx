import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { loadCustomer } from "@/lib/customer";
import { MEMBER_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import ProfileForm from "./ProfileForm";

export default async function ProfilePage() {
  const session = await requireMember();
  const customer = session.customerId ? await loadCustomer(session.customerId) : null;
  if (!customer) {
    return <div className="card">会員情報が見つかりません。</div>;
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">登録情報の変更</h1>
        <Link href="/mypage" className="text-brand underline">マイページへ戻る</Link>
      </div>
      <ProfileForm
        customer={customer}
        email={session.email ?? ""}
        avatarUrl={(customer as any).avatar_url ?? null}
        selfServiceEnabled={MEMBER_SELF_SERVICE_ENABLED}
      />
    </div>
  );
}
