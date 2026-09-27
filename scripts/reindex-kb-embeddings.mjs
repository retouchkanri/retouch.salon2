// KBエントリの埋め込みベクトルを生成して保存する（OpenAI text-embedding-3-small）。
// app_settings の openai_api_key / embedding_model を使用。管理画面の
// 「埋め込みを再生成」ボタンと同等の処理をローカルから実行するためのスクリプト。
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data: s } = await admin.from("app_settings").select("key,value");
const map = Object.fromEntries((s||[]).map(r=>[r.key,r.value]));
const apiKey = (map.openai_api_key||"").trim() || env.OPENAI_API_KEY;
const model = (map.embedding_model||"").trim() || "text-embedding-3-small";
if (!apiKey) { console.error("No OpenAI API key found."); process.exit(1); }
const { data: rows } = await admin.from("kb_entries").select("id,title,content,is_active").eq("is_active",true);
console.log(`Embedding ${rows.length} active entries with ${model}...`);
let done=0, failed=0;
for (const r of rows) {
  const input = `${r.title}\n\n${r.content}`.slice(0,8000);
  const res = await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({model,input})});
  if(!res.ok){ console.error(` ✗ ${r.title}: ${res.status} ${(await res.text()).slice(0,120)}`); failed++; continue; }
  const j = await res.json();
  const vec = j?.data?.[0]?.embedding;
  if(!Array.isArray(vec)){ console.error(` ✗ ${r.title}: invalid embedding`); failed++; continue; }
  const { error } = await admin.from("kb_entries").update({ embedding: vec }).eq("id", r.id);
  if(error){ console.error(` ✗ ${r.title}: ${error.message}`); failed++; continue; }
  done++; console.log(` ✓ ${r.title} (${vec.length} dims)`);
}
console.log(`\nDone: ${done} embedded, ${failed} failed.`);
// verify
const { data: check } = await admin.from("kb_entries").select("title,embedding").eq("is_active",true);
const stillNull = check.filter(c=>!c.embedding).map(c=>c.title);
console.log("Still null:", stillNull.length? stillNull.join(", ") : "none ✓");
