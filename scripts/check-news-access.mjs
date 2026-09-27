/**
 * ニュースの会員限定アクセス制御が正しく効いているかを確認する（読み取り専用・安全）。
 *
 *   node scripts/check-news-access.mjs
 *
 * ログインしていない匿名クライアント（NEXT_PUBLIC_SUPABASE_ANON_KEY）で
 * 「公開中かつ会員限定」のニュースが見えてしまわないかをチェックする。
 * 1件でも見えてしまう場合は supabase/migrations/20260711_news_fix_stale_public_policy.sql
 * を Supabase の SQL Editor で実行してください（apply_all.sql にも同内容を反映済み）。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}
const sbAnon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const { data, error } = await sbAnon
    .from("news")
    .select("id, title, public_access, is_published")
    .eq("is_published", true)
    .eq("public_access", "members_only");

  if (error) {
    console.error("❌ Query failed:", error.message);
    process.exit(1);
  }

  if ((data ?? []).length === 0) {
    console.log("✅ OK: 未ログイン状態では会員限定ニュースは1件も見えません。");
    process.exit(0);
  }

  console.log("❌ 問題あり: 未ログイン状態で以下の会員限定ニュースが見えてしまっています。");
  console.log(JSON.stringify(data, null, 2));
  console.log(
    "\n→ supabase/migrations/20260711_news_fix_stale_public_policy.sql を " +
      "Supabase ダッシュボード > SQL Editor で実行してください。",
  );
  process.exit(1);
}

main();
