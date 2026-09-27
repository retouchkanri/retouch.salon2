import Image from "next/image";
import AdminLoginForm from "./AdminLoginForm";

export default function AdminLoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="font-serif flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-2">
            <Image
              src="/logo.png"
              alt="Retouch"
              width={220}
              height={64}
              className="h-12 w-auto"
              priority
            />
          </div>
          <h1 className="text-xl font-bold text-brand">Retouch 管理画面</h1>
        </div>
        <div className="card">
          {searchParams.error === "forbidden" && (
            <p className="mb-3 text-danger text-sm">管理権限がありません。</p>
          )}
          <AdminLoginForm />
        </div>
      </div>
    </main>
  );
}
