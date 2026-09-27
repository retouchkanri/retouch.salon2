-- 会員限定ニュースがログインなしで読めてしまう不具合の修正。
--
-- 原因: supabase/apply_all.sql が独自の名前
-- ("news public read" / "news admin write"、スペース区切り) でポリシーを
-- 作成していたため、20260708_news_public_access.sql が同名で
-- drop/create していた ("news_public_read" / "news_admin_all"、アンダースコア)
-- ポリシーとは別物として残り続けていた。
-- Postgres の RLS は同一コマンドに対する permissive ポリシーを OR で
-- 合成するため、古い方（会員限定を判定しない）が生きているだけで
-- 新しい制限は無効化されてしまう。
--
-- このファイルは想定される全ての旧ポリシー名を確実に削除し、
-- 会員限定判定を含む正しいポリシーのみを残す。冪等なので再実行可。

alter table public.news add column if not exists pdf_urls text[] not null default '{}';
alter table public.news add column if not exists image_urls text[] not null default '{}';
alter table public.news add column if not exists public_access text not null default 'public';
do $$ begin
  alter table public.news add constraint news_public_access_check check (public_access in ('public', 'members_only'));
exception when duplicate_object then null; end $$;

alter table public.news enable row level security;

-- 存在しうる旧ポリシー名を総ざらいで削除する。
drop policy if exists "news public read" on public.news;
drop policy if exists "news admin write" on public.news;
drop policy if exists "news_admin_all" on public.news;
drop policy if exists "news_public_read" on public.news;

create policy "news_admin_all" on public.news
  for all using (public.is_admin()) with check (public.is_admin());

create policy "news_public_read" on public.news
  for select using (
    is_published = true
    and (
      public_access = 'public'
      or public.current_customer_id() is not null
      or public.is_admin()
    )
  );

-- 実行後、本当に旧ポリシーが残っていないか確認するには次を実行:
-- select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'news';
-- → news_admin_all と news_public_read の2件だけが表示されるはずです。
