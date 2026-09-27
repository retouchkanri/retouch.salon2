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
  started_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
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
