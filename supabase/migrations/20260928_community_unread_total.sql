-- =====================================================================
-- 会員コミュニティ: ヘッダーのコミュニティアイコンに未読メッセージ数を表示する（2026-09-28）
-- community_unread_summary() の戻り値に unread_total（他の人から届いた未読の合計。ミュートは除く）を追加する。
-- 適用: Supabase ダッシュボード → SQL Editor にこのファイルの全文を貼り付けて Run（再実行しても安全）。
-- supabase/community.sql にも同じ内容を反映済み。
-- =====================================================================

-- 未読数（サイトのヘッダーのバッジ用）。利用できない場合は null。
-- 一覧（community_list_channels）より軽い専用の集計にしている（全ページで呼ばれるため）。
create or replace function public.community_unread_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not public.community__is_member(v_uid) then
    return null;
  end if;

  with l as (
    select
      s.kind,
      coalesce(u.unread, 0) as unread_count,
      coalesce(u.mentions, 0) as mention_count,
      coalesce(
        s.notify,
        case when s.kind = 'dm' or s.post_policy = 'staff' then 'all' else 'mentions' end
      ) as eff_notify
    from public.community__visible_channels(v_uid) s
    left join lateral (
      select
        count(*) as unread,
        count(*) filter (where v_uid = any(msg.mentions) or msg.mention_channel) as mentions
      from public.community_messages msg
      where msg.channel_id = s.id
        and msg.parent_id is null
        and msg.deleted_at is null
        and msg.created_at > s.read_mark
        and msg.user_id is distinct from v_uid
    ) u on true
    where s.is_joined
  )
  select jsonb_build_object(
    'badge', coalesce(sum(
      case l.eff_notify
        when 'all' then l.unread_count
        when 'mentions' then l.mention_count
        else 0
      end
    ), 0),
    'has_unread', coalesce(bool_or(l.unread_count > 0 and l.eff_notify <> 'none'), false),
    'dm_unread', coalesce(sum(l.unread_count) filter (where l.kind = 'dm'), 0),
    -- 他の人から届いた未読メッセージの合計（ミュートしたチャンネルは除く。ヘッダーの赤い数字）
    'unread_total', coalesce(sum(l.unread_count) filter (where l.eff_notify <> 'none'), 0)
  )
  into v_result
  from l;

  return v_result;
end;
$$;
