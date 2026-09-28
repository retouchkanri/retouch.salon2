-- =====================================================================
-- 会員コミュニティ: チャンネルのアイコン（2026-09-28）
--
-- community_channels.icon に、チャンネルのアイコンを保存する。
--   ・アップロードした画像: VPS に保存したファイルのパス（/uploads/community-icons/...）
--   ・絵文字: 絵文字1つ（例: 📣）
--   ・null: 従来どおり # / 鍵のマーク
-- アイコンの変更はサーバー（/api/community/channels/<id>/icon）からのみ行う
-- （チャンネルの作成者と運営のみ。テーブルへの直接の書き込みは従来どおり不可）。
-- 既存のチャンネルには内容に合った絵文字を初期値として設定する（設定済みのものは変更しない）。
--
-- 適用: Supabase ダッシュボード → SQL Editor にこのファイルの全文を貼り付けて Run（再実行しても安全）。
-- supabase/community.sql にも同じ内容を反映済み。
-- =====================================================================

alter table public.community_channels add column if not exists icon text
  check (icon is null or char_length(icon) <= 300);

update public.community_channels c
  set icon = v.icon
from (values
  ('みんなの広場', '🏡'),
  ('自己紹介', '👋'),
  ('質問・相談', '💬'),
  ('写真・動画', '📷'),
  ('お知らせ', '📣'),
  ('全体', '🌿'),
  ('運営スタッフ', '🛡️')
) as v(name, icon)
where c.kind = 'channel' and c.name = v.name and c.icon is null;

-- 会員種別（ランク）ごとのチャンネル
update public.community_channels c
  set icon = v.icon
from (values
  ('A', '🐴'),
  ('B', '🤝'),
  ('C', '🌈'),
  ('OWNER', '👑'),
  ('SUPPORT', '💐'),
  ('RPT', '🐎'),
  ('SPECIAL_TEAM', '🏆')
) as v(code, icon)
where c.kind = 'channel' and c.audience = 'plans' and c.audience_plan_codes = array[v.code] and c.icon is null;
