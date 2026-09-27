-- =====================================================================
-- RLS 無限再帰の修正（管理画面でデータが 0 件になる問題）
--
-- 症状: 管理者でログインしても顧客数・契約・決済などが 0 と表示される。
--   profiles を直接読むと "stack depth limit exceeded"（無限再帰）になる。
--
-- 原因: is_admin() / current_customer_id() が SECURITY INVOKER（既定）で
--   profiles を参照しているが、その profiles 自身の RLS ポリシーが
--   is_admin() を呼ぶため、is_admin() で守られた全テーブル読み取りが
--   再帰してエラーになる（顧客一覧はビュー経由のため例外的に動いていた）。
--
-- 対処: 2 つのヘルパー関数を SECURITY DEFINER にし、関数内部の profiles
--   参照が RLS を介さない（=再帰しない）ようにする。関数は auth.uid() の
--   自分の行のみを読み、真偽値/uuid を返すだけなので安全。search_path も固定。
--
--   冪等（再実行可能）。これは owner / admin / moderator すべての管理画面で
--   データが表示されるようにする修正。
-- =====================================================================

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
