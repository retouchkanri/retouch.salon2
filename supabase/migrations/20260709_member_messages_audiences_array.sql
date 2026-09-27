-- =====================================================================
-- メルマガ配信対象の複数選択対応
--   member_messages.audiences（配列）を追加。配信対象チェックボックスで
--   複数選択された値をまとめて保持する。既存の audience（単一値）は
--   後方互換のため残し、履歴メッセージの表示・再解決に使う。
--
-- 冪等（再実行可）。Supabase SQL Editor にそのまま貼り付けて実行できます。
-- =====================================================================

alter table public.member_messages
  add column if not exists audiences text[] not null default '{}';

-- 既存メッセージ（単一 audience のみ）にも配列版を補完しておく。
-- 表示・配信対象解決コードが常に audiences を優先して参照できるようにするため。
update public.member_messages
set audiences = array[audience]
where audiences = '{}';
