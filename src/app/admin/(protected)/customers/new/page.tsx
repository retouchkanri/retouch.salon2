import Link from "next/link";
import NewCustomerForm from "./NewCustomerForm";

export default function NewCustomerPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">顧客の新規登録</h1>
        <Link href="/admin/customers" className="text-brand underline">← 戻る</Link>
      </div>
      <NewCustomerForm />
    </div>
  );
}
