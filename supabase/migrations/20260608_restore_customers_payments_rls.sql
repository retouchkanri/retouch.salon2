-- =====================================================================
-- customers / payments の RLS 復旧
--
-- 症状: 管理画面ダッシュボードで「会員数 = 0」「収益推移が空」になる。
--   一方で「継続契約 561」「本日の予約 1」「契約状態の内訳」は正常表示。
--
-- 切り分け:
--   - 契約・予約が出る  → セッションは管理者で is_admin() = true。
--   - anon キーでは全テーブル「エラーなしの 0 件」→ RLS 再帰は無し、
--     is_admin()/current_customer_id() 関数は正常（SECURITY DEFINER 済み）。
--   => 残る原因は customers / payments の SELECT ポリシーだけが
--      is_admin() 分岐を失っている（または制限的ポリシーが入っている）状態。
--
-- 対処: 両テーブルの正本ポリシー（apply_all.sql と同一）を冪等に再適用する。
--   既に正しい場合は実質 no-op。安全に再実行可能。
--
-- 適用方法: Supabase SQL Editor に貼り付けて実行。
--   実行前に末尾の確認クエリで現状を、実行後に再度実行して復旧を確認する。
-- =====================================================================

-- 念のため、ヘルパー関数が SECURITY DEFINER であることを再保証（冪等）。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('owner','admin','moderator')
  );
$$;

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select customer_id from public.profiles where id = auth.uid();
$$;

-- ---------- customers ----------
drop policy if exists "customers self select" on public.customers;
create policy "customers self select" on public.customers
  for select using (id = public.current_customer_id() or public.is_admin());
drop policy if exists "customers self update" on public.customers;
create policy "customers self update" on public.customers
  for update using (id = public.current_customer_id() or public.is_admin())
  with check (id = public.current_customer_id() or public.is_admin());
drop policy if exists "customers admin all" on public.customers;
create policy "customers admin all" on public.customers
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- payments ----------
drop policy if exists "payments scope" on public.payments;
create policy "payments scope" on public.payments
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "payments admin all" on public.payments;
create policy "payments admin all" on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- 確認クエリ（実行は任意）。
-- 想定外の制限的(RESTRICTIVE)ポリシーが付いていないかも確認すること。
-- permissive='RESTRICTIVE' の行があれば、それが admin 読み取りを
-- AND で打ち消している原因なので、その policyname を drop する。
-- =====================================================================
-- select tablename, policyname, permissive, cmd, qual
-- from pg_policies
-- where schemaname='public' and tablename in ('customers','payments')
-- order by tablename, policyname;
