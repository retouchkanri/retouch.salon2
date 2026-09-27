-- =====================================================================
-- Six-level role model
--   member / admin / staff  →  owner / admin / moderator / honorary_member / member / user
--
-- Role assignments for this deployment:
--   owner      = 野口 佳槻 (bagunet21@yahoo.co.jp)   ← password (re)set below
--   admin      = admin@gmail.com                      ← the sole administrator
--   moderator  = horse@gamil.com                      ← newly seeded
--   honorary   = anyone holding an RPT (RetouchPony【リタポ】) contract
--   member/user = unchanged
--
-- Idempotent and safe to re-run. Run order matters: the CHECK constraint is
-- widened BEFORE any row is set to one of the new role values.
-- =====================================================================

-- 1) Widen the role CHECK constraint to the six values.
--    Drop EVERY check constraint on profiles that references `role` (the
--    original may have an auto-generated name, and there can be more than one),
--    then add the single canonical constraint.
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner','admin','moderator','honorary_member','member','user'));

-- 2) Legacy staff → moderator.
update public.profiles set role = 'moderator' where role = 'staff';

-- 3) Reusable seed helper (create/update an auth user + identity + customer +
--    profile in one call). full_name is only set on INSERT, so real customer
--    names are never overwritten on re-run.
create or replace function public.seed_login_account(
  p_email text, p_password text, p_name text, p_role text
) returns void language plpgsql as $$
declare
  v_uid uuid;
  v_customer_id uuid;
begin
  select id into v_uid from auth.users where email = p_email;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      p_email, crypt(p_password, gen_salt('bf')),
      now(), null, null,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_name),
      now(), now(), '', '', '', ''
    );
  else
    update auth.users
      set encrypted_password = crypt(p_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_uid;
  end if;

  if not exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    insert into auth.identities (
      id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid, 'email', v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', p_email, 'email_verified', true),
      now(), now(), now()
    );
  end if;

  select id into v_customer_id from public.customers where email = p_email;
  if v_customer_id is null then
    insert into public.customers (auth_user_id, full_name, email, status)
    values (v_uid, p_name, p_email, 'active')
    returning id into v_customer_id;
  else
    update public.customers set auth_user_id = v_uid, status = 'active' where id = v_customer_id;
  end if;

  insert into public.profiles (id, role, customer_id)
  values (v_uid, p_role, v_customer_id)
  on conflict (id) do update
    set role = excluded.role, customer_id = excluded.customer_id, updated_at = now();
end $$;

-- 4) Apply role assignments (password == email for these bootstrap logins).
select public.seed_login_account('bagunet21@yahoo.co.jp', 'bagunet21@yahoo.co.jp', '野口 佳槻',   'owner');
select public.seed_login_account('admin@gmail.com',       'admin@gmail.com',       '管理者',       'admin');
select public.seed_login_account('horse@gamil.com',       'horse@gamil.com',       'モデレーター', 'moderator');

-- 5) RPT (RetouchPony【リタポ】) members become honorary members.
--    Never touches a staff role (owner/admin/moderator).
update public.profiles p
  set role = 'honorary_member'
  where p.role in ('member', 'user')
    and exists (
      select 1
      from public.contracts ct
      join public.membership_plans mp on mp.id = ct.plan_id
      where ct.customer_id = p.customer_id
        and mp.code = 'RPT'
    );

-- 6) Admin-area backstop: owner / admin / moderator are "staff" for RLS.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('owner','admin','moderator')
  );
$$;
