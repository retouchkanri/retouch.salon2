import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canSeeCommunity } from "@/lib/community/visibility";

export const dynamic = "force-dynamic";

/** ログイン中のユーザーにコミュニティへの導線（ヘッダー・スマホのボタン）を出すか */
export async function GET() {
  const session = await getSession();
  return NextResponse.json(
    { visible: session ? canSeeCommunity(session.role) : false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
