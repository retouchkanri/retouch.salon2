import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { assignableRoles } from "@/lib/roles";
import NewUserForm from "./NewUserForm";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const session = await requireCapability("users.manage");
  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ユーザー新規追加</h1>
        <Link href="/admin/users" className="text-brand underline">
          ← 戻る
        </Link>
      </div>
      <NewUserForm assignableRoles={assignableRoles(session.role)} />
    </div>
  );
}
