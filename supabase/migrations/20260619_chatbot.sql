-- =====================================================================
-- AIチャットボット（OpenAI + RAG）
--   app_settings : APIキー・モデル等の設定（管理者のみ）
--   kb_entries   : ナレッジベース（埋め込みベクトルで意味検索）
--   match_kb_entries : コサイン類似度で関連エントリを返す関数
--
-- 冪等（再実行可）。Supabase SQL Editor に貼り付けて実行できます。
-- pgvector 拡張を利用します（Supabase で利用可能）。
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------- app_settings（キー・バリュー設定） ----------
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
-- 設定（APIキー含む）は管理者のみ。チャットAPIはサービスロールで読むため公開policyは不要。
drop policy if exists "app_settings admin all" on public.app_settings;
create policy "app_settings admin all" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- kb_entries（ナレッジベース） ----------
create table if not exists public.kb_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  category text not null default '一般',
  is_active boolean not null default true,
  -- text-embedding-3-small の次元数（1536）。未生成時は null（キーワード検索にフォールバック）。
  embedding vector(1536),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kb_entries_active_idx on public.kb_entries (is_active);

drop trigger if exists kb_entries_set_updated_at on public.kb_entries;
create trigger kb_entries_set_updated_at before update on public.kb_entries
  for each row execute procedure public.tg_set_updated_at();

alter table public.kb_entries enable row level security;
-- ナレッジは管理者のみ読み書き（検索はチャットAPIがサービスロールで実行）。
drop policy if exists "kb_entries admin all" on public.kb_entries;
create policy "kb_entries admin all" on public.kb_entries
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- 意味検索関数（コサイン類似度） ----------
create or replace function public.match_kb_entries(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id uuid,
  title text,
  content text,
  category text,
  similarity float
)
language sql
stable
as $$
  select
    e.id, e.title, e.content, e.category,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.kb_entries e
  where e.is_active = true and e.embedding is not null
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_kb_entries(vector, int) to service_role, authenticated;

-- ---------- 初期ナレッジ（事務局が後から編集・追加できます） ----------
insert into public.kb_entries (title, content, category)
select v.title, v.content, v.category
from (values
  ('団体について', 'Retouchメンバーズサイトは、引退した競走馬（引退馬）を支援するための会員制サイトです。会員になると、馬への支援、見学会への参加、馬の面会などができます。', '基本'),
  ('会員登録', '会員登録は無料です。サイト上部の「無料で会員登録する」からお手続きいただけます。登録後はマイページで各種情報を確認できます。', '会員'),
  ('会員種別と会費', '基本会員種別はA会員（月額1,800円）・B会員（月額3,600円）・C会員（月額7,200円）があります。このほか、馬オーナー向けのオーナーズ会員（無料）などがあります。詳細・最新の金額はマイページまたは事務局へお問い合わせください。', '会員'),
  ('一口支援（馬ごとの支援）', '特定の馬を毎月支援できる「一口支援」があります。半口（月額6,000円）・1口（月額12,000円）から選べます。お申し込みは運営事務局にて承っております。', '支援'),
  ('単発寄付', '会員でなくても単発の寄付が可能です。トップページや /donate ページからクレジットカードまたは銀行振込でお手続きいただけます。', '支援'),
  ('見学会の申し込み', '牧場見学会の申し込みは、マイページまたは運営事務局にて承っております。日程・定員はイベントごとに異なります。', 'イベント'),
  ('馬の面会', '馬の面会（個別面会）は、半口以上の支援会員様限定のサービスです。マイページまたは事務局からお申し込みいただけます。', 'イベント'),
  ('退会・解約', '退会や各種お手続き（支援の停止・変更など）は、マイページまたは運営事務局にて承っております。', '会員'),
  ('メールマガジン', 'お知らせやイベント情報をメールマガジンでお届けしています。配信設定（受け取り/停止）はマイページの「メルマガ配信設定」から変更できます。', 'お知らせ'),
  ('お問い合わせ', 'ご不明な点は、サイトのお問い合わせフォーム、または事務局メールアドレスまでお気軽にご連絡ください。', 'サポート')
) as v(title, content, category)
where not exists (select 1 from public.kb_entries k where k.title = v.title);
