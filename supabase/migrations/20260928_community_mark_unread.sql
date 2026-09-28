-- =====================================================================
-- 会員コミュニティ: メッセージの「未読にする」（2026-09-28）
-- メッセージのメニューの「未読にする」で使う関数を追加する。
-- 適用: Supabase ダッシュボード → SQL Editor にこのファイルの全文を貼り付けて Run（再実行しても安全）。
-- supabase/community.sql にも同じ内容を反映済み。
-- =====================================================================

-- 「未読にする」: 指定したメッセージ以降を未読に戻す（既読位置をそのメッセージの直前へ移す）。
-- 戻り値は新しい既読位置。スレッド内の返信を指定した場合は、その親メッセージの位置を使う。
create or replace function public.community_mark_unread(p_message uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_msg record;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'ログインが必要です。' using errcode = '28000';
  end if;
  select m.channel_id, coalesce(p.created_at, m.created_at) as created_at
    into v_msg
  from public.community_messages m
  left join public.community_messages p on p.id = m.parent_id
  where m.id = p_message;
  if not found then
    raise exception 'メッセージが見つかりません。' using errcode = 'P0002';
  end if;
  if not public.community__can_read(v_msg.channel_id, v_uid) then
    raise exception 'このチャンネルは閲覧できません。' using errcode = '42501';
  end if;

  v_at := v_msg.created_at - interval '1 millisecond';
  update public.community_channel_members
    set last_read_at = v_at
  where channel_id = v_msg.channel_id and user_id = v_uid;
  if not found then
    -- まだ行が無い場合（自動参加の公開チャンネルなど）。community_mark_read と同じ扱いで、
    -- 非公開チャンネルを運営が覗いているだけなら記録せず、任意参加の公開チャンネルは未参加のままにする。
    if exists (
      select 1 from public.community_channels c
      where c.id = v_msg.channel_id and c.kind = 'channel' and c.visibility = 'private'
    ) then
      return v_at;
    end if;
    insert into public.community_channel_members (channel_id, user_id, last_read_at, hidden)
    select v_msg.channel_id, v_uid, v_at, (c.kind = 'channel' and c.visibility = 'public' and not c.auto_join)
    from public.community_channels c where c.id = v_msg.channel_id
    on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
  end if;
  return v_at;
end;
$$;

revoke all on function public.community_mark_unread(uuid) from public, anon;
grant execute on function public.community_mark_unread(uuid) to authenticated, service_role;
