-- =====================================================================
-- 馬の面会 申込（イベントマスタ365日問題の回避）
-- 半口・1口以上の支援者が希望日時を申し込む。管理画面で承認・CSV出力。
-- =====================================================================

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
