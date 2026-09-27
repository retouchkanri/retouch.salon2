-- =====================================================================
-- 権限（ロール）の保存フィールド + 初期データ
--   ログイン時、選択した権限と profiles.role が一致しないと弾かれる
--   （未設定だと既定値 'member'＝一般会員 になりログインできない）。
--   このスクリプトで 3 つの管理ロールを profiles に登録する。
--     owner     : 野口 佳槻 (bagunet21@yahoo.co.jp)
--     admin     : admin@gmail.com
--     moderator : horse@gamil.com
--
--   ※ 既存の auth ユーザー／パスワードには一切触れない（role のみ設定）。
--   ※ 冪等（再実行しても安全）。
-- =====================================================================

-- 1) role フィールドと6ロール制約を保証（旧スキーマの環境向けの保険）。
alter table public.profiles
  add column if not exists role text not null default 'member';

update public.profiles set role = 'admin' where role = 'staff';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner','admin','moderator','honorary_member','member','user'));

-- 2) 既存 auth ユーザーに profiles.role を登録（パスワードは変更しない）。
--    対象メールの auth ユーザーが存在しない場合は select が 0 行となり no-op。
insert into public.profiles (id, role, customer_id)
select u.id, 'owner', c.id
from auth.users u
left join public.customers c on c.email = u.email
where u.email = 'bagunet21@yahoo.co.jp'
on conflict (id) do update
  set role = excluded.role,
      customer_id = coalesce(profiles.customer_id, excluded.customer_id),
      updated_at = now();

insert into public.profiles (id, role, customer_id)
select u.id, 'admin', c.id
from auth.users u
left join public.customers c on c.email = u.email
where u.email = 'admin@gmail.com'
on conflict (id) do update
  set role = excluded.role,
      customer_id = coalesce(profiles.customer_id, excluded.customer_id),
      updated_at = now();

insert into public.profiles (id, role, customer_id)
select u.id, 'moderator', c.id
from auth.users u
left join public.customers c on c.email = u.email
where u.email = 'horse@gamil.com'
on conflict (id) do update
  set role = excluded.role,
      customer_id = coalesce(profiles.customer_id, excluded.customer_id),
      updated_at = now();

-- 3) 確認用（任意）: 登録結果を表示。
--    select u.email, p.role
--    from public.profiles p join auth.users u on u.id = p.id
--    where u.email in ('bagunet21@yahoo.co.jp','admin@gmail.com','horse@gamil.com')
--    order by p.role;
