import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const Q = "?w=600&h=400&fit=crop";

// Candidate pool of horse photos (base CDN ids). Verified at runtime.
const POOL_BASE = [
  "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a",
  "https://images.unsplash.com/photo-1694792651411-2412d8f235fb",
  "https://images.unsplash.com/photo-1586671267731-da2cf3ceeb80",
  "https://images.unsplash.com/photo-1508138221679-760a23a2285b",
  "https://images.unsplash.com/photo-1563830283-12f0a3ec7bf3",
  "https://images.unsplash.com/photo-1598974357801-cbca100e65d3",
  "https://images.unsplash.com/photo-1604429287879-6bc7a7572048",
  "https://images.unsplash.com/photo-1568466843852-cd639227cd90",
  "https://images.unsplash.com/photo-1563443803769-a5c44bd91e39",
  "https://images.unsplash.com/photo-1504020853563-338d87e28a89",
  "https://images.unsplash.com/photo-1603985724731-287f8d5faf7e",
  "https://images.unsplash.com/photo-1545780699-605328d5e41b",
  "https://images.unsplash.com/photo-1641226469620-16a914f597e3",
  "https://images.unsplash.com/photo-1534773728080-33d4c204b886",
];

async function urlOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function run() {
  // 1) Verify the replacement pool
  const pool: string[] = [];
  for (const base of POOL_BASE) {
    if (await urlOk(base + Q)) pool.push(base + Q);
  }
  console.log(`Verified pool size: ${pool.length}`);
  if (pool.length === 0) {
    console.error("No working pool images. Aborting.");
    process.exit(1);
  }

  // 2) Load horses
  const { data: horses, error } = await supabase
    .from("horses")
    .select("id, name, image_url")
    .order("sort_order");
  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  // 3) Test each, replace broken
  let poolIdx = 0;
  let fixed = 0;
  for (const h of horses ?? []) {
    const current = h.image_url as string | null;
    const ok = current ? await urlOk(current) : false;
    if (!ok) {
      const replacement = pool[poolIdx % pool.length];
      poolIdx++;
      const { error: upErr } = await supabase
        .from("horses")
        .update({ image_url: replacement })
        .eq("id", h.id);
      if (upErr) {
        console.error(`  Failed to update ${h.name}: ${upErr.message}`);
      } else {
        console.log(`  Fixed ${h.name} -> ${replacement}`);
        fixed++;
      }
    }
  }

  console.log(`\nDone. Fixed ${fixed} broken horse image(s) out of ${horses?.length ?? 0}.`);
}

run();
