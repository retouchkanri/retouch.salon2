-- ニュース記事に PDF 添付 URL カラムを追加
-- 既存レコードは pdf_url = NULL（添付なし）
alter table public.news add column if not exists pdf_url text;
