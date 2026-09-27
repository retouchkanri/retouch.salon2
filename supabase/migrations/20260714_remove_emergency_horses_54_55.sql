-- TOP「馬ごとの支援状況」から緊急支援募集馬（54・55番）を削除
-- 支援・特別チームが紐付いている場合は削除せず、募集停止に落とす

update public.horses
set is_supportable = false,
    is_emergency_recruitment = false
where name in ('54：緊急支援募集馬', '55：緊急支援募集馬')
  and (
    exists (select 1 from public.support_subscriptions ss where ss.horse_id = public.horses.id)
    or exists (select 1 from public.special_team_memberships stm where stm.horse_id = public.horses.id)
  );

delete from public.horses
where name in ('54：緊急支援募集馬', '55：緊急支援募集馬')
  and not exists (select 1 from public.support_subscriptions ss where ss.horse_id = public.horses.id)
  and not exists (select 1 from public.special_team_memberships stm where stm.horse_id = public.horses.id);
