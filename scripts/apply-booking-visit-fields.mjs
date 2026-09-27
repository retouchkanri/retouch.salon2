// 見学会（千葉・大阪）申込フォームの追加項目を bookings に適用する。
//   pickup (text) / riding (boolean) / companions (jsonb)
// 既存行に影響しない加算的変更。exec_sql RPC が無い場合は手動適用を案内する。
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const SQL = `
  alter table public.bookings add column if not exists pickup text;
  alter table public.bookings add column if not exists riding boolean not null default false;
  alter table public.bookings add column if not exists companions jsonb not null default '[]'::jsonb;
`;

async function run() {
  const { error } = await supabase.rpc("exec_sql", { query: SQL });
  if (error) {
    console.error("❌ exec_sql 失敗:", error.message);
    console.log("\nSupabase ダッシュボードの SQL Editor で以下を実行してください:");
    console.log("File: supabase/migrations/20260606_booking_visit_fields.sql\n");
    console.log(SQL);
    process.exit(1);
  }

  // 適用確認：列が読めるか
  const { error: checkErr } = await supabase
    .from("bookings")
    .select("id, pickup, riding, companions")
    .limit(1);
  if (checkErr) {
    console.error("⚠️  適用後の確認に失敗:", checkErr.message);
    process.exit(1);
  }
  console.log("✅ bookings に pickup / riding / companions を追加しました。");
}

run();
