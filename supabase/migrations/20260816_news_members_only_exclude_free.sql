-- 「会員限定」ニュースを、プラン未加入の会員（空白・無料会員）には
-- 表示しないようにする。
--
-- これまで会員限定記事は「ログイン中の会員」であれば誰でも閲覧できたが、
-- 有料プランへの移行を促すため、基本プラン(A/B/C/OWNER)・リタポ(RPT)・
-- 特別チームのいずれにも属さない「空白（無料）」会員には非表示にする。
-- 「空白」の定義は既存の会員一覧絞り込み・配信対象絞り込み（no_class）と同一
-- （member_class_code is null かつ rpt_active = false かつ special_team_count = 0）。
-- 参考: src/lib/memberMessages.ts の no_class フィルタ、
-- src/app/admin/(protected)/customers/page.tsx の cls=NONE フィルタ。
--
-- 全体公開(public)記事・未ログイン訪問者の扱いは変更なし。管理者は従来通り全件閲覧可。
-- 冪等（再実行可）。

create or replace function public.current_customer_is_blank_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.member_class_code is null
        and s.rpt_active = false
        and s.special_team_count = 0
      from public.v_customer_summary s
      where s.customer_id = public.current_customer_id()
    ),
    false
  );
$$;

drop policy if exists "news_public_read" on public.news;

create policy "news_public_read" on public.news
  for select using (
    is_published = true
    and (
      public_access = 'public'
      or (
        public.current_customer_id() is not null
        and not public.current_customer_is_blank_member()
      )
      or public.is_admin()
    )
  );

-- 実行後の確認:
-- select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'news';
-- → news_admin_all と news_public_read の2件のみが表示されるはずです。
