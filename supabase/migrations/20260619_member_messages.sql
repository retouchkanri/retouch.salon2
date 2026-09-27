-- =====================================================================
-- 会員向けメッセージ配信（お知らせ閲覧 + メルマガ）
--   member_messages            : 配信物（お知らせ/メルマガ）1件
--   member_message_recipients  : 会員ごとの配信先（既読/開封/配信状態）
--   customers.newsletter_opt_out : メルマガ配信停止フラグ（会員ごとの設定）
--
-- スケジュール配信・HTMLメール作成・開封トラッキング・配信停止リンクに対応。
-- 冪等（再実行可）。Supabase SQL Editor にそのまま貼り付けて実行できます。
-- =====================================================================

create extension if not exists "pgcrypto";

-- 会員ごとのメルマガ配信可否（配信停止リンク／マイページ設定で更新）
alter table public.customers
  add column if not exists newsletter_opt_out boolean not null default false;

-- ---------- member_messages（配信物） ----------
create table if not exists public.member_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  -- 'html': 管理者がHTMLを直接入力 / 'text': プレーンテキスト
  body_format text not null default 'html' check (body_format in ('html','text')),
  tag text not null default 'お知らせ',
  tag_color text not null default 'bg-brand-50 text-brand-dark',
  -- 配信チャネル（両方ONも可）
  channel_inapp boolean not null default true,
  channel_email boolean not null default false,
  -- 配信対象: all=全アクティブ会員 / subset=指定会員のみ
  audience text not null default 'all' check (audience in ('all','subset')),
  target_customer_ids uuid[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','sent','canceled')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,   -- メール送信成功数
  open_count integer not null default 0,   -- ユニーク開封数
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 最低1チャネルは有効であること
  constraint member_messages_channel_chk check (channel_inapp or channel_email)
);
create index if not exists member_messages_status_idx on public.member_messages (status);
create index if not exists member_messages_scheduled_idx on public.member_messages (scheduled_at);

-- ---------- member_message_recipients（会員ごとの配信先） ----------
create table if not exists public.member_message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.member_messages(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  email text,
  -- 開封ピクセル／配信停止リンクの識別子（推測不可）
  token uuid not null default gen_random_uuid(),
  email_status text not null default 'pending'
    check (email_status in ('pending','sent','failed','skipped')),
  sent_at timestamptz,
  opened_at timestamptz,     -- 初回開封日時
  open_count integer not null default 0,
  read_at timestamptz,       -- アプリ内（マイページ）既読日時
  error text,
  created_at timestamptz not null default now(),
  unique (message_id, customer_id)
);
create unique index if not exists member_message_recipients_token_idx
  on public.member_message_recipients (token);
create index if not exists member_message_recipients_message_idx
  on public.member_message_recipients (message_id);
create index if not exists member_message_recipients_customer_idx
  on public.member_message_recipients (customer_id);

-- updated_at トリガー（既存の共通関数を流用）
drop trigger if exists member_messages_set_updated_at on public.member_messages;
create trigger member_messages_set_updated_at before update on public.member_messages
  for each row execute procedure public.tg_set_updated_at();

-- ---------- RLS ----------
alter table public.member_messages enable row level security;
alter table public.member_message_recipients enable row level security;

-- 配信物: 管理者は全権。会員は「自分が配信対象 かつ アプリ内表示ON かつ 送信済み」のみ閲覧可。
drop policy if exists "member_messages admin all" on public.member_messages;
create policy "member_messages admin all" on public.member_messages
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "member_messages recipient read" on public.member_messages;
create policy "member_messages recipient read" on public.member_messages
  for select using (
    public.is_admin()
    or (
      channel_inapp = true
      and status = 'sent'
      and exists (
        select 1 from public.member_message_recipients r
        where r.message_id = member_messages.id
          and r.customer_id = public.current_customer_id()
      )
    )
  );

-- 配信先: 管理者は全権。会員は自分の行のみ参照・既読更新可。
drop policy if exists "member_message_recipients admin all" on public.member_message_recipients;
create policy "member_message_recipients admin all" on public.member_message_recipients
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "member_message_recipients self read" on public.member_message_recipients;
create policy "member_message_recipients self read" on public.member_message_recipients
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "member_message_recipients self update" on public.member_message_recipients;
create policy "member_message_recipients self update" on public.member_message_recipients
  for update using (customer_id = public.current_customer_id() or public.is_admin())
  with check (customer_id = public.current_customer_id() or public.is_admin());
