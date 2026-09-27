#!/usr/bin/env node
/**
 * Remove emergency support horses 54・55 from TOP / horses lists.
 * Usage: node scripts/remove-emergency-horses-54-55.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const NAMES = ["54：緊急支援募集馬", "55：緊急支援募集馬"];

async function main() {
  const { data: horses, error: listErr } = await sb
    .from("horses")
    .select("id, name, is_supportable")
    .in("name", NAMES);

  if (listErr) {
    console.error("Failed to list horses:", listErr.message);
    process.exit(1);
  }

  if (!horses?.length) {
    console.log("No matching horses found (already removed).");
    return;
  }

  for (const horse of horses) {
    const [{ count: supportCount }, { count: teamCount }] = await Promise.all([
      sb
        .from("support_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("horse_id", horse.id),
      sb
        .from("special_team_memberships")
        .select("id", { count: "exact", head: true })
        .eq("horse_id", horse.id),
    ]);

    const linked = (supportCount ?? 0) + (teamCount ?? 0) > 0;

    if (linked) {
      const { error } = await sb
        .from("horses")
        .update({ is_supportable: false, is_emergency_recruitment: false })
        .eq("id", horse.id);
      if (error) {
        // Column may not exist; fall back to supportable only
        const { error: e2 } = await sb
          .from("horses")
          .update({ is_supportable: false })
          .eq("id", horse.id);
        if (e2) {
          console.error(`Failed to deactivate ${horse.name}:`, e2.message);
          process.exit(1);
        }
      }
      console.log(`⚠️  Linked data exists — deactivated (not deleted): ${horse.name}`);
    } else {
      const { error } = await sb.from("horses").delete().eq("id", horse.id);
      if (error) {
        console.error(`Failed to delete ${horse.name}:`, error.message);
        process.exit(1);
      }
      console.log(`✅ Deleted: ${horse.name}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
