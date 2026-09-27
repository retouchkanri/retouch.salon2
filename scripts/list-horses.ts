import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function run() {
  const { data, error } = await supabase
    .from("horses")
    .select("id, name, name_kana, image_url, sort_order")
    .order("sort_order");
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Total horses: ${data?.length ?? 0}`);
  for (const h of data ?? []) {
    console.log(`- ${h.name} | kana=${h.name_kana ?? ""} | image=${h.image_url ?? "(none)"}`);
  }
}
run();
