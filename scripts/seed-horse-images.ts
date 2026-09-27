/**
 * Seed horse image URLs into the database.
 * Uses high-quality Unsplash horse photos for realistic display.
 *
 *   npx tsx scripts/seed-horse-images.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const HORSE_IMAGES = [
  "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1534773728080-33d4c204b886?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1598974357801-cbca100e65d3?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1504208434388-831e4f559ceb?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1509914398892-963f53e6e2f1?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1450052590821-8bf91254a353?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1601918774946-25832a4be0d6?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1551884831-bbf3cdc6469e?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1560919351-b9b6a40d6d5f?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1608505362930-d3007d406cc3?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1547407139-3c921a66005c?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1596401057633-54a8fe8ef7db?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1600958867916-8b71a93a8eb4?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1570130847085-3cd2e2db44b0?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1580934427536-c4962a0c6e4e?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1517026575980-3e1e2dedeab4?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1590244305050-4f8b1b2b2b2a?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1508616185939-ece67c898b87?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1559827291-bef0c8e58e5b?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1477884213360-7e9d7dcc8f9b?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1541364983171-a8ba01e95cfc?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1619459070078-49b6d4df3030?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1534567110243-8875d64ca8ff?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1611516818655-f2279e2ddf05?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1562140788-2a0740a79e56?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1546527868-ccb7ee7dfa6a?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1586671267731-da2cf3ceeb80?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1520466809213-7b9a56adcd45?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1508507608677-ebce0f2a4db1?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1566068256700-085ce5e3b1a1?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1628513014891-0e8aa03fbacf?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1532653234737-0e5d36ee2f91?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1593179531017-aa5eeb1e4809?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1614092590651-0e05f18f684a?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1606567595334-d39972c85dbe?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1635030379236-bc17f4e9d55e?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1483791341366-1f8b2c3f39db?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1576678483057-5fd3e3a7193c?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1508138221679-760a23a2285b?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1572099117584-4c40e6dbaee7?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1550136513-548af4445338?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1611082441125-faf7ea7fa427?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1518021964703-4b2030f03085?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1527224857830-43a7acc85260?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1533561052604-c3beb6d55b8d?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1529736576495-1ed4a29ca7e1?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1584714268709-c3dd9c92b378?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1603893399831-fa2be3d7f257?w=600&h=400&fit=crop",
  "https://images.unsplash.com/photo-1586601059901-4fca65e20e19?w=600&h=400&fit=crop",
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase credentials missing");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: horses, error } = await client
    .from("horses")
    .select("id, name")
    .order("sort_order");
  if (error) throw error;

  let updated = 0;
  for (let i = 0; i < (horses ?? []).length; i++) {
    const horse = horses![i];
    const imageUrl = HORSE_IMAGES[i % HORSE_IMAGES.length];
    const { error: upErr } = await client
      .from("horses")
      .update({ image_url: imageUrl })
      .eq("id", horse.id);
    if (!upErr) updated++;
  }

  console.log(`[seed-images] Updated ${updated} / ${horses?.length ?? 0} horses with image URLs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
