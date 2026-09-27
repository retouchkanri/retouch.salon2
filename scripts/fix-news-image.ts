import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function run() {
  const { error, data } = await supabase
    .from("news")
    .update({ image_url: "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=600&h=300&fit=crop" })
    .eq("title", "日本経済新聞で活動が紹介されました")
    .select("id, title");

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
  console.log(`Updated ${data?.length ?? 0} record(s):`, data);
}

run();
