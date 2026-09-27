-- =====================================================================
-- 会員登録フロー刷新：メール確認付き2段階登録 + 詳細プロフィール
--   1. customers に詳細プロフィール用カラムを追加（すべて nullable / 既存行は無影響）
--   2. registration_tokens（メール確認トークン）テーブルを新設
--
-- 冪等（再実行可）。Supabase SQL Editor にそのまま貼り付けて実行できます。
-- 適用後はサービスロールの select で反映を確認してください。
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- 1. customers の追加カラム ----------
alter table public.customers
  add column if not exists username text,
  add column if not exists last_name text,
  add column if not exists first_name text,
  add column if not exists last_name_kana text,
  add column if not exists first_name_kana text,
  add column if not exists prefecture text,
  add column if not exists address_city text,
  add column if not exists address_town text,
  add column if not exists address_building text,
  -- お知らせ通知の可否（false = 通知する）。メルマガは既存 newsletter_opt_out を流用。
  add column if not exists announcement_opt_out boolean not null default false,
  -- 本登録（プロフィール入力）完了フラグ。
  -- default true で「既存会員はすべて完了済み」として扱い、無影響にする。
  -- 新規の仮登録 stub のみアプリ側で false を明示セットする。
  add column if not exists registration_completed boolean not null default true;

-- ユーザーネームは一意（大小文字を区別せず重複を防ぐ）。NULL は重複可。
create unique index if not exists customers_username_unique_idx
  on public.customers (lower(username))
  where username is not null;

-- ---------- 2. registration_tokens（メール確認トークン） ----------
create table if not exists public.registration_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  customer_id uuid references public.customers(id) on delete cascade,
  email citext not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists registration_tokens_email_idx
  on public.registration_tokens (email);
create index if not exists registration_tokens_customer_idx
  on public.registration_tokens (customer_id);

-- サービスロール（管理用 admin client）からのみアクセスする。
-- RLS を有効化しつつポリシーを置かないことで、anon/authenticated からは
-- 一切読み書きできず、service_role のみがバイパスしてアクセスできる。
alter table public.registration_tokens enable row level security;
