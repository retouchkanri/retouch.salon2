-- =====================================================================
-- メルマガ配信対象の拡張 + PDF/画像添付
--   1) member_messages.audience に会員種別ごとの配信対象を追加
--      （アテンダー/オーナーズ/サポーター/メンバーズ/ヘルパーズ/リェリーフ/
--       がんがんチーム(特別チーム全体)を追加。リタポ・空白は既存の値を流用）
--   2) member_messages に image_urls / pdf_urls（複数添付）を追加
--
-- 冪等（再実行可）。Supabase SQL Editor にそのまま貼り付けて実行できます。
-- =====================================================================

-- 既存の audience CHECK 制約を名前によらず特定して削除
-- （本番では手動追加により rpt_only/support_only/no_class 済みの可能性があるため、
--   コミット済みの制約名を決め打ちせず動的に探して落とす）
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
    'all',            -- 全アクティブ会員
    'subset',         -- 手動指定した会員のみ
    'rpt_only',       -- リタポメンバー
    'support_only',   -- 1口支援者のみ（旧・互換用途。新規UIでは class_support を使用）
    'no_class',       -- 空白の人のみ（無料会員：基本プランなし かつ リタポなし かつ 特別チームなし）
    'class_attender', -- アテンダー会員
    'class_owner',    -- オーナーズ会員
    'class_b',        -- サポーター会員
    'class_a',        -- メンバーズ会員
    'class_c',        -- リェリーフ会員
    'class_support',  -- ヘルパーズ会員
    'team_only'       -- がんがんチーム（特別チーム会員全体）
  ));

-- 添付（複数対応・News と同じ配列カラム方式）
alter table public.member_messages
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists pdf_urls text[] not null default '{}';
