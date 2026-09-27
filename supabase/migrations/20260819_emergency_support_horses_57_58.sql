-- 緊急支援募集馬（57・58番、大阪→千葉）の追加
insert into public.horses (name, name_kana, profile, is_supportable, is_emergency_recruitment, sort_order)
select v.name, v.kana, v.profile, true, true, v.ord
from (values
  (
    '57：緊急支援募集馬',
    '57キンキュウシエンボシュウウマ',
    '大阪から千葉への移動を控えている57番目の子★支援募集開始★',
    -6
  ),
  (
    '58：緊急支援募集馬',
    '58キンキュウシエンボシュウウマ',
    '大阪から千葉への移動を控えている58番目の子★支援募集開始★',
    -5
  )
) as v(name, kana, profile, ord)
where not exists (select 1 from public.horses h where h.name = v.name);
