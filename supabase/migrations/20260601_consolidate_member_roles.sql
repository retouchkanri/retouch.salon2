-- =====================================================================
-- 会員ロールの統合（3階層 → 単一の「会員(member)」権限）
--   旧: owner / admin / moderator / honorary_member / member / user
--   新: owner / admin / moderator / member
--
--   名誉会員(honorary_member) と ユーザー(user) を member に統合する。
--   バッジは役割ではなく在籍期間・支払いで判定するため、これらの階層は不要。
--   ※ アプリ側は toRole() で実行時にも member に正規化するため、この移行は
--     データを綺麗にするための任意ステップ（実行しなくても動作する）。
--   ※ 冪等。CHECK 制約は6値のまま許容（旧データ・履歴マイグレーションと両立）。
-- =====================================================================

update public.profiles
  set role = 'member', updated_at = now()
  where role in ('honorary_member', 'user');

-- 確認用（任意）:
--   select role, count(*) from public.profiles group by role order by role;
