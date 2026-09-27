-- =====================================================================
-- Retouch Members Supabase — Combined setup script.
-- Run this file in the Supabase SQL editor in one go.
-- It is idempotent: safe to re-run.
--
-- Contents:
--   1. Schema (tables, enums, indexes, triggers, RLS, view)
--   2. Seed data (membership plans, sample horses/events)
--   3. Storage bucket for avatars (public)
--   4. Admin seed account (admin@gmail.com / admin@gmail.com)
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "citext";

-- ---------- enums ----------
do $$ begin
  create type member_plan_code as enum ('A','B','C','SPECIAL_TEAM','SUPPORT','RPT','OWNER');
exception when duplicate_object then null; end $$;
-- Backfill the RPT value for installations created before it was added.
alter type member_plan_code add value if not exists 'RPT';
alter type member_plan_code add value if not exists 'OWNER';

do $$ begin
  create type contract_status as enum ('active','past_due','canceled','paused','incomplete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('succeeded','failed','pending','refunded','canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_kind as enum ('subscription','donation','one_time');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_type as enum ('visit','private_visit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_status as enum ('reserved','canceled','attended','no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gender_type as enum ('male','female','other','unspecified');
exception when duplicate_object then null; end $$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','moderator','honorary_member','member','user')),
  customer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reconcile the role check constraint on databases created before the
-- 6-role model existed. `create table if not exists` skips the inline
-- constraint above when the table already exists, so legacy databases keep
-- the old ('member','admin','staff') constraint and reject 'owner' etc.
-- Legacy 'staff' rows are migrated to 'admin' first so the new constraint
-- can be added without violating existing data.
update public.profiles set role = 'admin' where role = 'staff';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner','admin','moderator','honorary_member','member','user'));

-- ---------- customers ----------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  stripe_customer_id text unique,
  full_name text not null,
  full_name_kana text,
  email citext unique,
  phone text,
  birthday date,
  gender gender_type default 'unspecified',
  postal_code text,
  address1 text,
  address2 text,
  avatar_url text,
  status text not null default 'active' check (status in ('active','suspended','withdrawn')),
  joined_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customers
  add column if not exists avatar_url text;
create index if not exists customers_email_idx on public.customers (lower(email));
create index if not exists customers_name_idx on public.customers (full_name);
create index if not exists customers_status_idx on public.customers (status);

-- 既存DB向け（create table if not exists が既存の profiles テーブルをスキップした
-- 場合、customer_id 列が無いまま次の FK 制約が失敗する: 42703）。
alter table public.profiles
  add column if not exists customer_id uuid;

alter table public.profiles
  drop constraint if exists profiles_customer_fkey;
alter table public.profiles
  add constraint profiles_customer_fkey
  foreign key (customer_id) references public.customers(id) on delete set null
  not valid;
alter table public.profiles validate constraint profiles_customer_fkey;

-- ---------- membership_plans ----------
create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  code member_plan_code not null,
  name text not null,
  monthly_amount integer not null,
  unit_amount integer,
  allow_with_support boolean not null default false,
  allow_with_team boolean not null default true,
  stripe_price_id text,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code, name)
);

-- ---------- horses ----------
create table if not exists public.horses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_kana text,
  sex text,
  birth_year integer,
  retired_at date,
  profile text,
  image_url text,
  stripe_price_half_id text,
  stripe_price_full_id text,
  is_supportable boolean not null default true,
  is_emergency_recruitment boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists horses_supportable_idx on public.horses (is_supportable);

-- ---------- contracts ----------
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  plan_id uuid references public.membership_plans(id) on delete set null,
  stripe_subscription_id text unique,
  status contract_status not null default 'active',
  current_period_end timestamptz,
  started_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contracts_customer_idx on public.contracts (customer_id);
create index if not exists contracts_status_idx on public.contracts (status);

-- ---------- support_subscriptions ----------
create table if not exists public.support_subscriptions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  horse_id uuid not null references public.horses(id) on delete restrict,
  units numeric(6,2) not null check (units > 0),
  monthly_amount integer not null,
  stripe_subscription_item_id text,
  status contract_status not null default 'active',
  started_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists supports_customer_idx on public.support_subscriptions (customer_id);
create index if not exists supports_horse_idx on public.support_subscriptions (horse_id);
create index if not exists supports_status_idx on public.support_subscriptions (status);

-- ---------- donations ----------
create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  donor_name text,
  donor_email citext,
  amount integer not null check (amount > 0),
  message text,
  stripe_payment_intent_id text unique,
  stripe_checkout_session_id text,
  status payment_status not null default 'pending',
  payment_method text not null default 'card' check (payment_method in ('card','bank_transfer')),
  confirmed_at timestamptz,
  note text,
  donated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- 既存DB向け（create table が既存テーブルをスキップした場合に備える）
alter table public.donations
  add column if not exists payment_method text not null default 'card';
alter table public.donations drop constraint if exists donations_payment_method_check;
alter table public.donations
  add constraint donations_payment_method_check check (payment_method in ('card','bank_transfer'));
alter table public.donations add column if not exists confirmed_at timestamptz;
alter table public.donations add column if not exists note text;
create index if not exists donations_customer_idx on public.donations (customer_id);
create index if not exists donations_date_idx on public.donations (donated_at desc);

-- ---------- events ----------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  type event_type not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  capacity integer not null default 0,
  location text,
  supporters_only boolean not null default false,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_type_idx on public.events (type);
create index if not exists events_starts_idx on public.events (starts_at);
-- 既存DBに sort_order が無い場合は先にカラムを追加してからインデックスを作成する
alter table public.events add column if not exists sort_order integer not null default 0;
create index if not exists events_sort_order_idx on public.events (sort_order);

-- ---------- bookings ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  party_size integer not null default 1 check (party_size > 0),
  note text,
  status booking_status not null default 'reserved',
  booked_at timestamptz not null default now(),
  canceled_at timestamptz,
  unique (customer_id, event_id)
);
-- 既存DB向け（create table if not exists が既存の bookings テーブルをスキップした
-- 場合、event_id 列が無いまま次のインデックスが失敗する: 42703）。
alter table public.bookings add column if not exists customer_id uuid;
alter table public.bookings add column if not exists event_id uuid;
alter table public.bookings add column if not exists party_size integer not null default 1;
alter table public.bookings add column if not exists note text;
alter table public.bookings add column if not exists status booking_status not null default 'reserved';
alter table public.bookings add column if not exists booked_at timestamptz not null default now();
alter table public.bookings add column if not exists canceled_at timestamptz;
alter table public.bookings drop constraint if exists bookings_party_size_check;
alter table public.bookings
  add constraint bookings_party_size_check check (party_size > 0);
alter table public.bookings
  drop constraint if exists bookings_customer_id_fkey;
alter table public.bookings
  add constraint bookings_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete cascade
  not valid;
alter table public.bookings validate constraint bookings_customer_id_fkey;
alter table public.bookings
  drop constraint if exists bookings_event_id_fkey;
alter table public.bookings
  add constraint bookings_event_id_fkey
  foreign key (event_id) references public.events(id) on delete cascade
  not valid;
alter table public.bookings validate constraint bookings_event_id_fkey;
alter table public.bookings drop constraint if exists bookings_customer_id_event_id_key;
alter table public.bookings
  add constraint bookings_customer_id_event_id_key unique (customer_id, event_id);
create index if not exists bookings_event_idx on public.bookings (event_id);
create index if not exists bookings_customer_idx on public.bookings (customer_id);
-- 見学会（千葉・大阪）申込フォームの追加項目（migrations/20260606_booking_visit_fields.sql）
alter table public.bookings add column if not exists pickup text;
alter table public.bookings add column if not exists riding boolean not null default false;
alter table public.bookings add column if not exists companions jsonb not null default '[]'::jsonb;

-- ---------- horse meeting requests (馬の面会) ----------
create table if not exists public.horse_meeting_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  applicant_name text not null,
  facility text not null,
  party_size integer not null check (party_size > 0 and party_size <= 20),
  preferred_date date not null,
  preferred_time_slot text not null,
  supported_horses text not null,
  arrival_method text not null,
  pickup_time text,
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'canceled', 'completed')),
  admin_note text,
  requested_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists horse_meeting_requests_customer_idx
  on public.horse_meeting_requests (customer_id);
create index if not exists horse_meeting_requests_status_idx
  on public.horse_meeting_requests (status);
create index if not exists horse_meeting_requests_date_idx
  on public.horse_meeting_requests (preferred_date desc);

-- ---------- payments ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  contract_id uuid references public.contracts(id) on delete set null,
  donation_id uuid references public.donations(id) on delete set null,
  kind payment_kind not null,
  amount integer not null,
  currency text not null default 'jpy',
  status payment_status not null default 'pending',
  stripe_event_id text,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  failure_reason text,
  occurred_at timestamptz not null default now(),
  raw jsonb,
  created_at timestamptz not null default now()
);
-- 既存DB向け（create table が既存テーブルをスキップした場合に備える）
alter table public.payments add column if not exists stripe_charge_id text;
create index if not exists payments_customer_idx on public.payments (customer_id);
create index if not exists payments_status_idx on public.payments (status);
create index if not exists payments_occurred_idx on public.payments (occurred_at desc);
-- Stripe→DB 同期の冪等性キー（upsert onConflict 用）。
create unique index if not exists payments_stripe_charge_id_key on public.payments (stripe_charge_id);

-- ---------- admin memos ----------
create table if not exists public.admin_memos (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  body text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (customer_id, slot)
);

-- ---------- audit logs ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- updated_at triggers
-- =====================================================================
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'customers','membership_plans','horses','contracts',
    'support_subscriptions','events','profiles'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I
                    for each row execute procedure public.tg_set_updated_at()', t, t);
  end loop;
end $$;

-- =====================================================================
-- Helpers
-- =====================================================================
-- SECURITY DEFINER is required: these helpers read public.profiles, and
-- profiles' own RLS policies call is_admin(). Without DEFINER the inner read
-- re-enters the policy and recurses ("stack depth limit exceeded"), which makes
-- every is_admin()-gated admin read return empty. DEFINER bypasses RLS inside
-- the function (it only reads the caller's own row via auth.uid()).
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

-- =====================================================================
-- Row level security
-- =====================================================================
alter table public.customers enable row level security;
alter table public.profiles enable row level security;
alter table public.membership_plans enable row level security;
alter table public.horses enable row level security;
alter table public.contracts enable row level security;
alter table public.support_subscriptions enable row level security;
alter table public.donations enable row level security;
alter table public.events enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.admin_memos enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles admin write" on public.profiles;
create policy "profiles admin write" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

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

drop policy if exists "plans public read" on public.membership_plans;
create policy "plans public read" on public.membership_plans for select using (true);
drop policy if exists "plans admin write" on public.membership_plans;
create policy "plans admin write" on public.membership_plans
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "horses public read" on public.horses;
create policy "horses public read" on public.horses for select using (true);
drop policy if exists "horses admin write" on public.horses;
create policy "horses admin write" on public.horses
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "contracts scope" on public.contracts;
create policy "contracts scope" on public.contracts
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "contracts admin all" on public.contracts;
create policy "contracts admin all" on public.contracts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "supports scope" on public.support_subscriptions;
create policy "supports scope" on public.support_subscriptions
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "supports admin all" on public.support_subscriptions;
create policy "supports admin all" on public.support_subscriptions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "donations scope" on public.donations;
create policy "donations scope" on public.donations
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "donations admin all" on public.donations;
create policy "donations admin all" on public.donations
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "events public read" on public.events;
create policy "events public read" on public.events
  for select using (is_published = true or public.is_admin());
drop policy if exists "events admin write" on public.events;
create policy "events admin write" on public.events
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "bookings self read" on public.bookings;
create policy "bookings self read" on public.bookings
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "bookings self insert" on public.bookings;
create policy "bookings self insert" on public.bookings
  for insert with check (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "bookings self update" on public.bookings;
create policy "bookings self update" on public.bookings
  for update using (customer_id = public.current_customer_id() or public.is_admin())
  with check (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "bookings admin all" on public.bookings;
create policy "bookings admin all" on public.bookings
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.horse_meeting_requests enable row level security;
drop policy if exists "horse_meetings self read" on public.horse_meeting_requests;
create policy "horse_meetings self read" on public.horse_meeting_requests
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "horse_meetings self insert" on public.horse_meeting_requests;
create policy "horse_meetings self insert" on public.horse_meeting_requests
  for insert with check (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "horse_meetings self update" on public.horse_meeting_requests;
create policy "horse_meetings self update" on public.horse_meeting_requests
  for update using (customer_id = public.current_customer_id() or public.is_admin())
  with check (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "horse_meetings admin all" on public.horse_meeting_requests;
create policy "horse_meetings admin all" on public.horse_meeting_requests
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "payments scope" on public.payments;
create policy "payments scope" on public.payments
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "payments admin all" on public.payments;
create policy "payments admin all" on public.payments
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "memos admin only" on public.admin_memos;
create policy "memos admin only" on public.admin_memos
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "audit admin only" on public.audit_logs;
create policy "audit admin only" on public.audit_logs
  for select using (public.is_admin());

-- =====================================================================
-- Customer summary view
-- =====================================================================
-- NOTE: v_customer_summary は special_team_memberships（team_name 含む）に
-- 依存するため、そのテーブル定義より後（ファイル末尾）で作成します。
-- 定義はこのファイルの末尾「Customer summary view (definition)」を参照。

-- =====================================================================
-- Seed data
-- =====================================================================
insert into public.membership_plans (code, name, monthly_amount, unit_amount, allow_with_support, allow_with_team, sort_order, description)
values
  ('A', 'A会員', 1800, null, false, true, 10, '月額1,800円の基本会員プラン'),
  ('B', 'B会員', 3600, null, false, true, 20, '月額3,600円のスタンダード会員プラン'),
  ('C', 'C会員', 7200, null, false, true, 30, '月額7,200円のプレミアム会員プラン'),
  ('SPECIAL_TEAM', '特別チーム会員', 1000, null, true, true, 40, '月額1,000円の特別チーム会員（他会員と併用可能）')
on conflict (code, name) do update
  set monthly_amount = excluded.monthly_amount,
      allow_with_support = excluded.allow_with_support,
      allow_with_team = excluded.allow_with_team,
      description = excluded.description,
      updated_at = now();

insert into public.membership_plans (code, name, monthly_amount, unit_amount, allow_with_support, allow_with_team, sort_order, description)
values
  ('SUPPORT', '半口支援', 6000, 6000, true, true, 50, '馬ごとの半口支援（月額6,000円/口）'),
  ('SUPPORT', '1口支援', 12000, 12000, true, true, 60, '馬ごとの1口支援（月額12,000円/口）')
on conflict (code, name) do update
  set monthly_amount = excluded.monthly_amount,
      unit_amount = excluded.unit_amount,
      description = excluded.description,
      updated_at = now();

-- RetouchPony【リタポ】メンバー (RPT): flat ¥3,000/month, combinable with all
-- other plans. Sign-ups are handled externally via Stripe; this row exists so
-- the plan is manageable in admin and assignable to contracts.
--
-- NOTE: Postgres forbids using an enum value in the same transaction that
-- ADDed it (error 55P04). On an EXISTING database the `alter type ... add
-- value 'RPT'` above is not yet committed when this seed runs, so the insert
-- is wrapped to skip cleanly; re-running this script (or the migration having
-- been applied earlier) lets the insert succeed. On a FRESH install the value
-- is part of `create type`, so it inserts on the first run.
do $$
begin
  insert into public.membership_plans (code, name, monthly_amount, unit_amount, allow_with_support, allow_with_team, sort_order, description)
  values
    ('RPT', 'RetouchPony【リタポ】メンバー', 3000, null, true, true, 45, '月額3,000円のRetouch Ponys Team（RPT）メンバー（他会員と併用可能）')
  on conflict (code, name) do update
    set monthly_amount = excluded.monthly_amount,
        allow_with_support = excluded.allow_with_support,
        allow_with_team = excluded.allow_with_team,
        description = excluded.description,
        updated_at = now();
exception when others then
  raise notice 'RPT plan seed skipped (enum value not yet committed — re-run this script once more): %', sqlerrm;
end $$;

do $$
begin
  insert into public.membership_plans (
    code, name, monthly_amount, unit_amount,
    allow_with_support, allow_with_team, sort_order, description, is_active
  )
  select
    'OWNER', 'オーナーズ会員', 0, null,
    false, true, 35, '馬オーナー向け無料会員（決済・Stripe なし・管理画面から手動登録）', true
  where not exists (
    select 1 from public.membership_plans
    where code = 'OWNER' and name = 'オーナーズ会員' and is_active = true
  );
exception when others then
  raise notice 'OWNER plan seed skipped (enum value not yet committed — re-run this script once more): %', sqlerrm;
end $$;

-- 重複プランの自動整理（要件 #5）。会員名変更後にこのseedが再実行されると
-- 旧名称（A会員 等）が空の重複として再作成されるため、契約0件かつ「契約ありの
-- 同コード兄弟」が存在するプランのみ無効化する。契約が紐づくプランは残す。
-- 新規インストール（契約0件）では何も無効化されない。削除はしない。
update public.membership_plans mp
set is_active = false, updated_at = now()
where mp.is_active = true
  and not exists (select 1 from public.contracts c where c.plan_id = mp.id)
  and exists (
    select 1
    from public.membership_plans sib
    join public.contracts c2 on c2.plan_id = sib.id
    where sib.code = mp.code and sib.id <> mp.id
  );

-- ダミー馬データを削除（支援・契約等が紐付いていない場合のみ）
delete from public.horses
where name in ('ミドリノカゼ','ハヤテボーイ','サクラエース')
  and not exists (select 1 from public.support_subscriptions ss where ss.horse_id = public.horses.id)
  and not exists (select 1 from public.special_team_memberships stm where stm.horse_id = public.horses.id);

-- is_emergency_recruitment 列（緊急募集表示用）。54・55番のシードは削除済み。
alter table public.horses
  add column if not exists is_emergency_recruitment boolean not null default false;

delete from public.horses
where name in ('54：緊急支援募集馬', '55：緊急支援募集馬')
  and not exists (select 1 from public.support_subscriptions ss where ss.horse_id = public.horses.id)
  and not exists (select 1 from public.special_team_memberships stm where stm.horse_id = public.horses.id);

insert into public.events (type, title, description, starts_at, ends_at, capacity, location, supporters_only, is_published)
select 'visit','定期見学会 6月','牧場での引退馬見学会。',
       (now() + interval '30 days')::date + time '10:00',
       (now() + interval '30 days')::date + time '12:00',
       20, '牧場本場', false, true
where not exists (select 1 from public.events e where e.title = '定期見学会 6月');

insert into public.events (type, title, description, starts_at, ends_at, capacity, location, supporters_only, is_published)
select 'private_visit','個別見学（支援者限定）','支援者の方のみ申込可能。',
       (now() + interval '45 days')::date + time '13:00',
       (now() + interval '45 days')::date + time '15:00',
       6, '牧場本場', true, true
where not exists (select 1 from public.events e where e.title = '個別見学（支援者限定）');

-- =====================================================================
-- Storage bucket for avatars (public read, authenticated write)
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars authenticated upload" on storage.objects;
create policy "avatars authenticated upload" on storage.objects
  for insert with check (bucket_id = 'avatars');

drop policy if exists "avatars authenticated update" on storage.objects;
create policy "avatars authenticated update" on storage.objects
  for update using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

drop policy if exists "avatars authenticated delete" on storage.objects;
create policy "avatars authenticated delete" on storage.objects
  for delete using (bucket_id = 'avatars');

-- =====================================================================
-- Seed login accounts (password == email for these bootstrap logins):
--   owner     = 野口 佳槻 (bagunet21@yahoo.co.jp)
--   admin     = admin@gmail.com         (the sole administrator)
--   moderator = horse@gamil.com
-- Each call creates/updates auth.users (bcrypt password) + auth.identities +
-- public.customers + public.profiles. full_name is only set on INSERT, so
-- real customer names are never overwritten on re-run.
-- =====================================================================
create or replace function public.seed_login_account(
  p_email text, p_password text, p_name text, p_role text
) returns void language plpgsql as $$
declare
  v_uid uuid;
  v_customer_id uuid;
begin
  select id into v_uid from auth.users where email = p_email;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      p_email, crypt(p_password, gen_salt('bf')),
      now(), null, null,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_name),
      now(), now(), '', '', '', ''
    );
  else
    update auth.users
      set encrypted_password = crypt(p_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_uid;
  end if;

  if not exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    insert into auth.identities (
      id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid, 'email', v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', p_email, 'email_verified', true),
      now(), now(), now()
    );
  end if;

  select id into v_customer_id from public.customers where email = p_email;
  if v_customer_id is null then
    insert into public.customers (auth_user_id, full_name, email, status)
    values (v_uid, p_name, p_email, 'active')
    returning id into v_customer_id;
  else
    update public.customers set auth_user_id = v_uid, status = 'active' where id = v_customer_id;
  end if;

  insert into public.profiles (id, role, customer_id)
  values (v_uid, p_role, v_customer_id)
  on conflict (id) do update
    set role = excluded.role, customer_id = excluded.customer_id, updated_at = now();
end $$;

select public.seed_login_account('bagunet21@yahoo.co.jp', 'bagunet21@yahoo.co.jp', '野口 佳槻',   'owner');
select public.seed_login_account('admin@gmail.com',       'admin@gmail.com',       '管理者',       'admin');
select public.seed_login_account('horse@gamil.com',       'horse@gamil.com',       'モデレーター', 'moderator');

-- =====================================================================
-- News table (homepage carousel)
-- =====================================================================
create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  tag text not null default 'お知らせ',
  tag_color text not null default 'bg-brand-50 text-brand-dark',
  image_url text,
  pdf_url text,
  published_at timestamptz not null default now(),
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_news_published on public.news (is_published, published_at desc);
-- 既存DB向け（create table が既存テーブルをスキップした場合に備える）
alter table public.news add column if not exists pdf_url text;
-- 本文内の複数PDF・複数画像添付（NewsForm の複数アップロード機能用）
alter table public.news add column if not exists pdf_urls text[] not null default '{}';
alter table public.news add column if not exists image_urls text[] not null default '{}';
-- PDFの元ファイル名（pdf_urls と同じ並び順）。migrations/20260711_news_pdf_names.sql と同一内容。
alter table public.news add column if not exists pdf_names text[] not null default '{}';
-- 公開範囲（全体公開 / 会員限定）。既存レコードは 'public'（従来どおり全体公開）。
alter table public.news add column if not exists public_access text not null default 'public';
do $$ begin
  alter table public.news add constraint news_public_access_check check (public_access in ('public', 'members_only'));
exception when duplicate_object then null; end $$;

alter table public.news enable row level security;

-- 古い（アクセス範囲を判定しない）ポリシー名が残っている場合は削除する。
drop policy if exists "news public read" on public.news;
drop policy if exists "news admin write" on public.news;
drop policy if exists "news_admin_all" on public.news;
drop policy if exists "news_public_read" on public.news;

-- 管理者は常に全件アクセス可（未公開・会員限定を含む）。
create policy "news_admin_all" on public.news
  for all using (public.is_admin()) with check (public.is_admin());

-- 公開記事は誰でも閲覧可。会員限定記事はログイン中の会員（current_customer_id）と
-- 管理者のみ閲覧可 — ログインしていない訪問者には members_only 記事を一切返さない。
create policy "news_public_read" on public.news
  for select using (
    is_published = true
    and (
      public_access = 'public'
      or public.current_customer_id() is not null
      or public.is_admin()
    )
  );

-- updated_at trigger for news
drop trigger if exists news_set_updated_at on public.news;
create trigger news_set_updated_at before update on public.news
  for each row execute procedure public.tg_set_updated_at();

-- ダミーニュース記事を削除（運営が手動で作成した実データは残す）
delete from public.news
where title in (
  '新しい支援馬「コスモブライト」を追加しました',
  '6月牧場見学会のお申込み受付開始',
  'メンバーズサイトをリニューアルしました',
  '日本経済新聞で活動が紹介されました',
  '年次活動報告書を公開しました',
  '春の感謝イベントを開催しました',
  '冬季の馬たちの健康レポート',
  '新年のご挨拶と2026年の活動計画',
  'Stripe決済システムをアップデートしました',
  '年末年始の事務局休業のお知らせ',
  'ホースセラピー体験プログラム開始',
  '支援者数600名を突破しました'
);

-- =====================================================================
-- Special Team membership (特別チーム会員)
--   - Per-horse, fixed 1,000円/month.
--   - Combinable with ALL other plans (A/B/C and 支援会員).
--   - Isolated table so it never interferes with contracts /
--     support_subscriptions queries.
-- =====================================================================
create table if not exists public.special_team_memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  horse_id uuid not null references public.horses(id) on delete restrict,
  monthly_amount integer not null default 1000,
  stripe_subscription_id text,
  stripe_subscription_item_id text,
  status contract_status not null default 'active',
  team_name text,
  started_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 既存DB向け（create table が既存テーブルをスキップした場合に備える）
alter table public.special_team_memberships
  add column if not exists team_name text;
create index if not exists special_team_customer_idx on public.special_team_memberships (customer_id);
create index if not exists special_team_horse_idx on public.special_team_memberships (horse_id);
create index if not exists special_team_status_idx on public.special_team_memberships (status);
create index if not exists special_team_sub_idx on public.special_team_memberships (stripe_subscription_id);

alter table public.special_team_memberships enable row level security;

drop policy if exists "special_team scope" on public.special_team_memberships;
create policy "special_team scope" on public.special_team_memberships
  for select using (customer_id = public.current_customer_id() or public.is_admin());
drop policy if exists "special_team admin all" on public.special_team_memberships;
create policy "special_team admin all" on public.special_team_memberships
  for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists special_team_set_updated_at on public.special_team_memberships;
create trigger special_team_set_updated_at before update on public.special_team_memberships
  for each row execute procedure public.tg_set_updated_at();

-- =====================================================================
-- Customer summary view (definition)
-- =====================================================================
-- 会員種別 / 支援数 / 特別参加 の3区分を返す（要件 #2）。
-- special_team_memberships.team_name を参照するため、同テーブル定義の後で作成。
-- 詳細は migrations/20260601_member_classification.sql を参照。
-- 列の追加・並び替えを伴うため create or replace では置換できない（42P16）。
-- 一旦 drop してから作り直す。
drop view if exists public.v_customer_summary;
create view public.v_customer_summary as
select
  c.id as customer_id,
  c.full_name,
  c.full_name_kana,
  c.email,
  c.status,
  c.avatar_url,
  -- 基本会員区分（A/B/C/OWNER のみ。RPT・特別チームは含めない）
  basic_plan.plan_code as primary_plan_code,
  basic_plan.plan_name as primary_plan_name,
  -- 会員種別コード: 基本契約(A/B/C/OWNER) > 無ければ支援(SUPPORT) > 無ければ null
  coalesce(
    basic_plan.plan_code::text,
    case when coalesce(support_agg.horse_count, 0) > 0 then 'SUPPORT' end
  ) as member_class_code,
  coalesce(support_agg.total_units, 0)  as total_support_units,
  coalesce(support_agg.horse_count, 0)  as total_support_horses,
  -- 月額合計 = 馬ごとの支援額合計 + 基本会費(A/B/C)。
  -- 詳細は migrations/20260608_monthly_total_include_basic.sql を参照。
  coalesce(support_agg.monthly_total, 0) + coalesce(basic_plan.plan_monthly, 0) as monthly_total,
  contract_agg.current_period_end as next_payment_at,
  contract_agg.contract_status as contract_status,
  -- 特別参加
  coalesce(rpt_agg.active, false) as rpt_active,
  coalesce(team_agg.team_count, 0) as special_team_count,
  team_agg.team_names as special_team_names
from public.customers c
left join lateral (
  select mp.code as plan_code, mp.name as plan_name, mp.monthly_amount as plan_monthly
  from public.contracts ct
  join public.membership_plans mp on mp.id = ct.plan_id
  where ct.customer_id = c.id and ct.status = 'active'
    and mp.code::text in ('A', 'B', 'C', 'OWNER')
  order by ct.started_at desc limit 1
) basic_plan on true
left join lateral (
  select
    sum(ss.units) as total_units,
    count(distinct ss.horse_id) as horse_count,
    sum(ss.monthly_amount) as monthly_total
  from public.support_subscriptions ss
  where ss.customer_id = c.id and ss.status = 'active'
) support_agg on true
left join lateral (
  select bool_or(ct.status = 'active') as active
  from public.contracts ct
  join public.membership_plans mp on mp.id = ct.plan_id
  where ct.customer_id = c.id and ct.status = 'active' and mp.code = 'RPT'
) rpt_agg on true
left join lateral (
  select
    count(*) as team_count,
    array_agg(distinct coalesce(nullif(st.team_name, ''), h.name))
      filter (where st.horse_id is not null or st.team_name is not null) as team_names
  from public.special_team_memberships st
  left join public.horses h on h.id = st.horse_id
  where st.customer_id = c.id and st.status = 'active'
) team_agg on true
left join lateral (
  select current_period_end, status::text as contract_status
  from public.contracts ct
  where ct.customer_id = c.id
  order by current_period_end desc nulls last limit 1
) contract_agg on true;

-- =====================================================================
-- Audit-log full-text search RPC
-- =====================================================================
-- audit_logs.meta is jsonb, which PostgREST's .or(ilike) can't body-search.
-- This function searches action / target_table / the meta JSON body / the
-- actor's name+email server-side, and returns the requested page plus the
-- total match count. SECURITY INVOKER (default) → the "audit admin only" RLS
-- policy still applies (non-admins get 0 rows).
create or replace function public.search_audit_logs(
  p_q text default null,
  p_action text default null,
  p_table text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  actor_id uuid,
  action text,
  target_table text,
  target_id uuid,
  meta jsonb,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
as $$
  with filtered as (
    select a.*
    from public.audit_logs a
    where (p_action is null or p_action = '' or a.action = p_action)
      and (p_table is null or p_table = '' or a.target_table = p_table)
      and (
        p_q is null or p_q = ''
        or a.action ilike '%' || p_q || '%'
        or coalesce(a.target_table, '') ilike '%' || p_q || '%'
        or a.meta::text ilike '%' || p_q || '%'
        or exists (
          select 1
          from public.profiles p
          join public.customers c on c.id = p.customer_id
          where p.id = a.actor_id
            and (
              coalesce(c.full_name, '') ilike '%' || p_q || '%'
              or coalesce(c.email::text, '') ilike '%' || p_q || '%'
            )
        )
      )
  )
  select
    f.id, f.actor_id, f.action, f.target_table, f.target_id, f.meta, f.created_at,
    count(*) over () as total_count
  from filtered f
  order by f.created_at desc
  offset greatest(p_offset, 0)
  limit greatest(p_limit, 1);
$$;

grant execute on function public.search_audit_logs(text, text, text, int, int) to authenticated;

-- =====================================================================
-- 会員向けメッセージ配信（お知らせ閲覧 + メルマガ）
--   migrations/20260619_member_messages.sql と同一内容（冪等）。
--   member_messages / member_message_recipients / customers.newsletter_opt_out
-- =====================================================================
alter table public.customers
  add column if not exists newsletter_opt_out boolean not null default false;

create table if not exists public.member_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  body_format text not null default 'html' check (body_format in ('html','text')),
  tag text not null default 'お知らせ',
  tag_color text not null default 'bg-brand-50 text-brand-dark',
  channel_inapp boolean not null default true,
  channel_email boolean not null default false,
  audience text not null default 'all' check (audience in ('all','subset')),
  target_customer_ids uuid[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','sent','canceled')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  open_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_messages_channel_chk check (channel_inapp or channel_email)
);
create index if not exists member_messages_status_idx on public.member_messages (status);
create index if not exists member_messages_scheduled_idx on public.member_messages (scheduled_at);

create table if not exists public.member_message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.member_messages(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  email text,
  token uuid not null default gen_random_uuid(),
  email_status text not null default 'pending'
    check (email_status in ('pending','sent','failed','skipped')),
  sent_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  read_at timestamptz,
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

drop trigger if exists member_messages_set_updated_at on public.member_messages;
create trigger member_messages_set_updated_at before update on public.member_messages
  for each row execute procedure public.tg_set_updated_at();

alter table public.member_messages enable row level security;
alter table public.member_message_recipients enable row level security;

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

-- =====================================================================
-- AIチャットボット（OpenAI + RAG）
--   migrations/20260619_chatbot.sql と同一内容（冪等）。
--   app_settings / kb_entries / match_kb_entries（pgvector 利用）
-- =====================================================================
create extension if not exists "vector";

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "app_settings admin all" on public.app_settings;
create policy "app_settings admin all" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.kb_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  category text not null default '一般',
  is_active boolean not null default true,
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
drop policy if exists "kb_entries admin all" on public.kb_entries;
create policy "kb_entries admin all" on public.kb_entries
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.match_kb_entries(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (id uuid, title text, content text, category text, similarity float)
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

-- =====================================================================
-- 会員登録フロー刷新：メール確認付き2段階登録 + 詳細プロフィール
--   migrations/20260622_registration_flow.sql と同一内容（冪等）。
--   customers の詳細プロフィール用カラム + registration_tokens テーブル。
-- =====================================================================
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
  -- 本登録（プロフィール入力）完了フラグ。default true で既存会員は完了扱い（無影響）。
  add column if not exists registration_completed boolean not null default true;

-- ユーザーネームは一意（大小文字を区別せず重複を防ぐ）。NULL は重複可。
create unique index if not exists customers_username_unique_idx
  on public.customers (lower(username))
  where username is not null;

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
-- RLS 有効＋ポリシー無し ＝ anon/authenticated からは不可、service_role のみバイパス。
alter table public.registration_tokens enable row level security;

-- =====================================================================
-- 20260708_member_messages_audience_attachments.sql
-- メルマガ配信対象の拡張（会員種別ごと・がんがんチーム）＋ PDF/画像添付
-- =====================================================================
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.member_messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%audience%'
  loop
    execute format('alter table public.member_messages drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.member_messages add constraint member_messages_audience_check
  check (audience in (
    'all', 'subset', 'rpt_only', 'support_only', 'no_class',
    'class_attender', 'class_owner', 'class_b', 'class_a', 'class_c', 'class_support', 'team_only'
  ));

alter table public.member_messages
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists pdf_urls text[] not null default '{}';

-- =====================================================================
-- 20260709_member_messages_audiences_array.sql
-- メルマガ配信対象の複数選択対応（audiences 配列カラム）
-- =====================================================================
alter table public.member_messages
  add column if not exists audiences text[] not null default '{}';

update public.member_messages
set audiences = array[audience]
where audiences = '{}';

-- =====================================================================
-- 20260816_news_members_only_exclude_free.sql
-- 「会員限定」ニュースを、プラン未加入の会員（空白・無料会員）には表示しない。
-- 「空白」の定義は no_class フィルタと同一
-- （member_class_code is null かつ rpt_active = false かつ special_team_count = 0）。
-- v_customer_summary 作成後に実行する必要があるため、ここ（ファイル末尾）に配置。
-- =====================================================================
create or replace function public.current_customer_is_blank_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.member_class_code is null
        and s.rpt_active = false
        and s.special_team_count = 0
      from public.v_customer_summary s
      where s.customer_id = public.current_customer_id()
    ),
    false
  );
$$;

drop policy if exists "news_public_read" on public.news;

create policy "news_public_read" on public.news
  for select using (
    is_published = true
    and (
      public_access = 'public'
      or (
        public.current_customer_id() is not null
        and not public.current_customer_is_blank_member()
      )
      or public.is_admin()
    )
  );
