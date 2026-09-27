-- =====================================================================
-- 監査ログの全文検索 RPC（要件: 検索はページ内ではなく全件対象）
--   audit_logs.meta は jsonb のため PostgREST の .or(ilike) では本文検索
--   できない。この関数でサーバ側で meta::text を含めて検索し、ページング
--   と総件数（total_count）も同時に返す。
--
--   検索対象: action / target_table / meta(json本文) / 操作者の氏名・メール
--   （actor_id → profiles.id, profiles.customer_id → customers.id）。
--
--   SECURITY INVOKER（既定）なので audit_logs の RLS「audit admin only」が
--   そのまま適用される＝管理者以外が呼んでも0件。
-- =====================================================================

create or replace function public.search_audit_logs(
  p_q text default null,
  p_action text default null,
  p_table text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  actor_id uuid,
  action text,
  target_table text,
  target_id uuid,
  meta jsonb,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
as $$
  with filtered as (
    select a.*
    from public.audit_logs a
    where (p_action is null or p_action = '' or a.action = p_action)
      and (p_table is null or p_table = '' or a.target_table = p_table)
      and (
        p_q is null or p_q = ''
        or a.action ilike '%' || p_q || '%'
        or coalesce(a.target_table, '') ilike '%' || p_q || '%'
        or a.meta::text ilike '%' || p_q || '%'
        or exists (
          select 1
          from public.profiles p
          join public.customers c on c.id = p.customer_id
          where p.id = a.actor_id
            and (
              coalesce(c.full_name, '') ilike '%' || p_q || '%'
              or coalesce(c.email::text, '') ilike '%' || p_q || '%'
            )
        )
      )
  )
  select
    f.id, f.actor_id, f.action, f.target_table, f.target_id, f.meta, f.created_at,
    count(*) over () as total_count
  from filtered f
  order by f.created_at desc
  offset greatest(p_offset, 0)
  limit greatest(p_limit, 1);
$$;

grant execute on function public.search_audit_logs(text, text, text, int, int) to authenticated;
