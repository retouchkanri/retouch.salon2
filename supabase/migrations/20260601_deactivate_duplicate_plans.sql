-- =====================================================================
-- 会員プラン重複の整理（要件 #5）
--
-- 背景: 会員名の変更後に初期データ（apply_all のプランseed）が再実行され、
--   旧名称（A会員/B会員/C会員/特別チーム会員/半口支援/1口支援）が
--   「契約の紐づかない空の重複プラン」として再作成された。一方、実際に
--   契約が紐づくのは改名後のプラン（メンバーズ会員 等）側。
--
-- 方針（メッセージ #5 の通り）:
--   ・契約が紐づくプランは履歴保持のため残す（削除しない・有効のまま）。
--   ・契約が0件で、同じコードに「契約ありの兄弟プラン」が存在する重複だけを
--     無効化する（新規登録の選択肢から外す）。削除はしない。
--
-- 安全・冪等:
--   ・新規インストール（契約0件）では何も無効化されない（兄弟に契約が無いため）。
--   ・再実行しても結果は同じ。料金・既存契約・決済には影響しない。
-- =====================================================================

update public.membership_plans mp
set is_active = false, updated_at = now()
where mp.is_active = true
  and not exists (select 1 from public.contracts c where c.plan_id = mp.id)
  and exists (
    select 1
    from public.membership_plans sib
    join public.contracts c2 on c2.plan_id = sib.id
    where sib.code = mp.code and sib.id <> mp.id
  );
