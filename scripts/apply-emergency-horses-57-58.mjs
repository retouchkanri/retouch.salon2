import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const rows = [
  {
    name: "57：緊急支援募集馬",
    name_kana: "57キンキュウシエンボシュウウマ",
    profile: "大阪から千葉への移動を控えている57番目の子★支援募集開始★",
    is_supportable: true,
    is_emergency_recruitment: true,
    sort_order: -6,
  },
  {
    name: "58：緊急支援募集馬",
    name_kana: "58キンキュウシエンボシュウウマ",
    profile: "大阪から千葉への移動を控えている58番目の子★支援募集開始★",
    is_supportable: true,
    is_emergency_recruitment: true,
    sort_order: -5,
  },
];

for (const row of rows) {
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
    console.log(`Skip (already exists): ${row.name}`);
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
  .select("id, name, profile, is_supportable, is_emergency_recruitment, sort_order")
  .in("name", rows.map((r) => r.name));
if (probe) {
  console.error("Probe failed:", probe.message);
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
