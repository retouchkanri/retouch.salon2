-- =====================================================================
-- 見学会（千葉・大阪）申込フォームの追加項目
--   bookings に以下を追加（既存行に影響しない加算的変更）:
--     pickup     text     送迎の希望（集合場所コード。希望なしは 'none' / null）
--     riding     boolean  体験乗馬（約5分）の希望（千葉のみ・既定 false）
--     companions jsonb    同伴者（最大3名）。要素 = {name, relation}
--                         relation: 'family' | 'friend' | 'other'
--   詳細は src/lib/events.ts（会場判定・選択肢の定義）を参照。
-- =====================================================================

alter table public.bookings add column if not exists pickup text;
alter table public.bookings add column if not exists riding boolean not null default false;
alter table public.bookings add column if not exists companions jsonb not null default '[]'::jsonb;
