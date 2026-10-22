-- v67: serviciile oferite de fiecare specialist + intarire grant-uri staff_private.
-- Semantica: un specialist FARA randuri in staff_services face toate serviciile
-- (compatibil cu firmele existente). Idempotenta.

create table if not exists public.staff_services (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, service_id)
);

create index if not exists staff_services_service_id_idx
  on public.staff_services (service_id);

alter table public.staff_services enable row level security;

-- Doar SELECT/INSERT/DELETE (fara UPDATE/TRUNCATE/TRIGGER/REFERENCES).
revoke all on public.staff_services from public, anon, authenticated, service_role;
grant select on public.staff_services to anon;
grant select, insert, delete on public.staff_services to authenticated, service_role;

-- Citire publica (pagina /b): doar pentru specialistii activi.
drop policy if exists staff_services_public_read on public.staff_services;
create policy staff_services_public_read on public.staff_services
  for select to anon, authenticated
  using (
    staff_id in (select s.id from public.staff s where s.active)
  );

-- Proprietarul isi vede si specialistii inactivi (ecranul Echipa).
drop policy if exists staff_services_owner_read on public.staff_services;
create policy staff_services_owner_read on public.staff_services
  for select to authenticated
  using (
    staff_id in (
      select s.id
      from public.staff s
      join public.business_profiles b on b.id = s.business_id
      where b.owner_user_id = (select auth.uid())
    )
  );

-- Proprietarul adauga doar perechi specialist+serviciu din AFACEREA LUI.
drop policy if exists staff_services_owner_insert on public.staff_services;
create policy staff_services_owner_insert on public.staff_services
  for insert to authenticated
  with check (
    (staff_id, service_id) in (
      select s.id, sv.id
      from public.staff s
      join public.services sv on sv.business_id = s.business_id
      join public.business_profiles b on b.id = s.business_id
      where b.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists staff_services_owner_delete on public.staff_services;
create policy staff_services_owner_delete on public.staff_services
  for delete to authenticated
  using (
    staff_id in (
      select s.id
      from public.staff s
      join public.business_profiles b on b.id = s.business_id
      where b.owner_user_id = (select auth.uid())
    )
  );

-- Intarire v65: authenticated doar CRUD pe staff_private (fara TRUNCATE/TRIGGER/REFERENCES).
revoke all on public.staff_private from authenticated;
grant select, insert, update, delete on public.staff_private to authenticated;

notify pgrst, 'reload schema';