-- 緊急支援募集馬（54・55番）の追加
-- ※ 20260714 で削除。このファイルは履歴として残し、再実行しても追加しない。
alter table public.horses
  add column if not exists is_emergency_recruitment boolean not null default false;

-- 54・55は削除済み（再投入しない）
-- insert into public.horses ... '54：緊急支援募集馬' / '55：緊急支援募集馬'
