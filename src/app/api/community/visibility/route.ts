import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { communityVisibleFor } from "@/lib/community/access";

export const dynamic = "force-dynamic";

/** ログイン中のユーザーにコミュニティへの導線（ヘッダー・スマホのボタン）を出すか（運営と有料会員のみ） */
export async function GET() {
  const session = await getSession();
  return NextResponse.json(
    { visible: session ? await communityVisibleFor(session.role) : false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
