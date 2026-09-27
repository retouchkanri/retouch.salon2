-- イベントに表示順カラムを追加
-- 既存レコードは sort_order = 0（同順の場合は starts_at で降順）
alter table public.events add column if not exists sort_order integer not null default 0;
create index if not exists events_sort_order_idx on public.events (sort_order);
