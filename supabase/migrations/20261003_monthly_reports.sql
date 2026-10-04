-- 経営管理の月次収支報告。公開済みの数字は snapshot に固定する。
-- 会員画面は service role 経由でのみ読む。一般ロール向けのポリシーは付けない。

create table if not exists public.monthly_reports (
  year_month text primary key check (year_month ~ '^\d{4}-\d{2}$'),
  expenses jsonb not null default '{}'::jsonb,
  horse_count integer check (horse_count is null or horse_count >= 0),
  note text,
  published_at timestamptz,
  snapshot jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.monthly_reports enable row level security;
