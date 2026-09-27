import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function uploadImage(localName, storageName) {
  const buffer = readFileSync(
    new URL(`../src/assets/images/${localName}`, import.meta.url),
  );
  const path = `horses/${storageName}`;
  const { error } = await sb.storage
    .from("avatars")
    .upload(path, buffer, { contentType: "image/jpeg", upsert: true });
  if (error) {
    throw new Error(`Upload failed for ${localName}: ${error.message}`);
  }
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error(`Could not get public URL for ${localName}`);
  }
  return data.publicUrl;
}

const [url57, url58, url59, url60] = await Promise.all([
  uploadImage("57.jpg", "57-emergency.jpg"),
  uploadImage("58.jpg", "58-emergency.jpg"),
  uploadImage("59.jpg", "59-emergency.jpg"),
  uploadImage("60.jpg", "60-emergency.jpg"),
]);
console.log("Uploaded images:", { url57, url58, url59, url60 });

// 57・58 は既存レコードに画像URLを追加するだけ（新規追加は 59・60 のみ）
const updates = [
  {
    name: "57：緊急支援募集馬",
    image_url: url57,
    profile: "大阪から千葉への移動を控えている57番目の子★支援募集開始★",
    sort_order: -9,
  },
  {
    name: "58：緊急支援募集馬",
    image_url: url58,
    profile: "大阪から千葉への移動を控えている58番目の子（牝馬）★支援募集開始★",
    sort_order: -8,
  },
];
for (const u of updates) {
  const { error } = await sb
    .from("horses")
    .update({
      image_url: u.image_url,
      profile: u.profile,
      is_emergency_recruitment: true,
      is_supportable: true,
      sort_order: u.sort_order,
    })
    .eq("name", u.name);
  if (error) {
    console.error(`Update FAILED for ${u.name}:`, error.message);
    process.exit(1);
  }
  console.log(`Updated: ${u.name}`);
}

const inserts = [
  {
    name: "59：緊急支援募集馬",
    name_kana: "59キンキュウシエンボシュウウマ",
    profile: "大阪から千葉への移動を控えている59番目の子（仔馬）★支援募集開始★",
    image_url: url59,
    is_supportable: true,
    is_emergency_recruitment: true,
    sort_order: -7,
  },
  {
    name: "60：緊急支援募集馬",
    name_kana: "60キンキュウシエンボシュウウマ",
    profile: "大阪から千葉への移動を控えている60番目の子（白いどさんこ）★支援募集開始★",
    image_url: url60,
    is_supportable: true,
    is_emergency_recruitment: true,
    sort_order: -6,
  },
];
for (const row of inserts) {
  const { data: existing, error: findErr } = await sb
    .from("horses")
    .select("id")
    .eq("name", row.name)
    .maybeSingle();
  if (findErr) {
    console.error(`Lookup FAILED for ${row.name}:`, findErr.message);
    process.exit(1);
  }
  if (existing) {
    console.log(`Skip insert (already exists), updating image instead: ${row.name}`);
    const { error } = await sb
      .from("horses")
      .update({
        image_url: row.image_url,
        profile: row.profile,
        is_emergency_recruitment: true,
        is_supportable: true,
        sort_order: row.sort_order,
      })
      .eq("id", existing.id);
    if (error) {
      console.error(`Update FAILED for ${row.name}:`, error.message);
      process.exit(1);
    }
    continue;
  }
  const { error: insertErr } = await sb.from("horses").insert(row);
  if (insertErr) {
    console.error(`Insert FAILED for ${row.name}:`, insertErr.message);
    process.exit(1);
  }
  console.log(`Inserted: ${row.name}`);
}

const { data, error: probe } = await sb
  .from("horses")
  .select("id, name, profile, image_url, is_supportable, is_emergency_recruitment, sort_order")
  .in("name", ["57：緊急支援募集馬", "58：緊急支援募集馬", "59：緊急支援募集馬", "60：緊急支援募集馬"])
  .order("sort_order");
if (probe) {
  console.error("Probe failed:", probe.message);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
