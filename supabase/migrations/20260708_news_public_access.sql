-- ニュースの公開範囲（全体公開 / 会員限定）
-- 既存レコードは public_access = 'public'（従来どおり全体公開）
alter table public.news
  add column if not exists public_access text not null default 'public'
  check (public_access in ('public', 'members_only'));

-- news_admin_all が USING (true) のままだと anon キーでの直接アクセスでも
-- 会員限定記事が読めてしまうため、他テーブルと同様に is_admin() 判定に統一する。
-- （管理画面の書き込みは service role 経由のため挙動に影響なし）
drop policy if exists "news_admin_all" on public.news;
create policy "news_admin_all" on public.news
  for all using (public.is_admin()) with check (public.is_admin());

-- 公開記事は誰でも閲覧可。会員限定記事はログイン中の会員（current_customer_id）と
-- 管理者のみ閲覧可。
drop policy if exists "news_public_read" on public.news;
create policy "news_public_read" on public.news
  for select using (
    is_published = true
    and (
      public_access = 'public'
      or public.current_customer_id() is not null
      or public.is_admin()
    )
  );
