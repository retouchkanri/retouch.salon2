import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** ログアウト後は常にトップページへ戻す。 */
async function logoutAndGoHome(req: Request) {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", new URL(req.url).origin), { status: 303 });
}

export async function POST(req: Request) {
  return logoutAndGoHome(req);
}

export async function GET(req: Request) {
  return logoutAndGoHome(req);
}
