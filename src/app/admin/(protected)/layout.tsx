import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import AdminNav from "./AdminNav";
import { readNavPrefs } from "./navPrefs";
import BottomRightPanel from "@/components/BottomRightPanel";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const navPrefs = readNavPrefs(cookies());

  return (
    <div className="font-serif flex min-h-0 flex-1 flex-col md:block">
      {/* Sidebar: fixed below the (sticky) header on desktop so it stays put
          while the main content scrolls; collapsible to an icon rail. It is
          the `peer` that tells <main> which left margin to use. On mobile it
          stacks above the content as a fold-out menu. */}
      <AdminNav role={session.role} initialPrefs={navPrefs} />
      <main className="p-3 md:p-4 md:ml-[240px] md:transition-[margin] md:duration-200 md:ease-out md:peer-data-[rail=true]:ml-[68px] overflow-x-auto bg-surface-soft">
        {children}
      </main>
      {/* 管理画面はトップへ戻るボタンのみ（寄付・チャットは非表示）。 */}
      <BottomRightPanel showDonate={false} showChat={false} />
    </div>
  );
}
