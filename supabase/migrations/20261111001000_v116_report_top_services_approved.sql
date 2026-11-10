-- v116 — Rapoarte „Top servicii” numără doar programările aprobate și onorate (test încrucișat P9).
-- Înainte, numărul includea și anulatele, respinsele și cele în așteptare, iar venitul doar
-- aprobatele: după o anulare venitul scădea, numărul nu. Acum ambele au aceeași bază.
-- PREGĂTIT, NEAPLICAT: schimbă rezultatul unei funcții existente (regula: se aplică doar
-- migrări strict aditive). Compatibil cu 3.23 (aceeași formă JSON). Restul funcției e identic
-- cu v89 (verificat identic cu definiția live pe 11.11.2026).

create or replace function public.business_report(p_days int default 30)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_biz uuid;
  v_from timestamptz;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_days < 1 or p_days > 365 then
    p_days := 30;
  end if;
  v_from := now() - make_interval(days => p_days);

  select m.business_id into v_biz
  from public.business_members m
  where m.user_id = v_user and m.role in ('owner', 'admin')
  order by m.created_at
  limit 1;
  if v_biz is null then
    select id into v_biz from public.business_profiles
    where owner_user_id = v_user order by created_at limit 1;
  end if;
  if v_biz is null then
    raise exception 'not_owner';
  end if;

  select jsonb_build_object(
    'days', p_days,
    'approved', count(*) filter (where a.status = 'approved'),
    'pending', count(*) filter (where a.status = 'pending'),
    'cancelled', count(*) filter (where a.status = 'cancelled'),
    'rejected', count(*) filter (where a.status = 'rejected'),
    'no_show', count(*) filter (where a.no_show),
    'loyalty_redeemed', count(*) filter (where a.loyalty_redeemed),
    'revenue_ron', coalesce(sum(a.service_price) filter (
      where a.status = 'approved' and coalesce(a.no_show, false) = false
    ), 0),
    'deposits_ron', coalesce(sum(a.deposit_ron) filter (where a.payment_status = 'paid'), 0)
  )
  into v_out
  from public.appointments a
  where a.business_id = v_biz
    and a.start_at >= v_from;

  v_out := v_out || jsonb_build_object(
    'top_services', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'name', coalesce(a.service_name, 'Ședință'),
          'count', count(*),
          'revenue_ron', coalesce(sum(a.service_price), 0)
        ) as x
        from public.appointments a
        where a.business_id = v_biz and a.start_at >= v_from
          and a.status = 'approved' and coalesce(a.no_show, false) = false
        group by coalesce(a.service_name, 'Ședință')
        order by count(*) desc
        limit 5
      ) s
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'name', coalesce(a.staff_name, '—'),
          'approved', count(*) filter (where a.status = 'approved'),
          'no_show', count(*) filter (where a.no_show),
          'revenue_ron', coalesce(sum(a.service_price) filter (
            where a.status = 'approved' and coalesce(a.no_show, false) = false
          ), 0)
        ) as x
        from public.appointments a
        where a.business_id = v_biz and a.start_at >= v_from
        group by coalesce(a.staff_name, '—')
        order by count(*) filter (where a.status = 'approved') desc
      ) s
    ), '[]'::jsonb),
    'avg_rating', (select avg_rating from public.business_rating(v_biz)),
    'review_count', (select review_count from public.business_rating(v_biz))
  );

  return v_out;
end;
$$;
