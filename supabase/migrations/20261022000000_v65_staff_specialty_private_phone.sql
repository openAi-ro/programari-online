-- v65: specialitate publica pe staff + telefon privat in public.staff_private.
-- Telefonul NU sta in public.staff (citibil de anon pentru randurile active):
-- e intr-un tabel separat, doar proprietarul il citeste/scrie; pagina publica
-- primeste numai telefoanele marcate publice prin get_public_staff_phones().
-- Idempotenta: se poate rula de mai multe ori.

-- 1. Specialitatea (publica, max 60 caractere)
alter table public.staff add column if not exists specialty text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_specialty_len_chk'
  ) then
    alter table public.staff
      add constraint staff_specialty_len_chk
      check (specialty is null or char_length(specialty) <= 60);
  end if;
end $$;

comment on column public.staff.specialty is
  'Specialitatea afisata pe pagina publica (ex. Fade, Colorist), max 60 caractere.';

-- 2. Date private ale specialistului (telefon)
create table if not exists public.staff_private (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  phone text,
  phone_public boolean not null default false,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_private_phone_len_chk'
  ) then
    alter table public.staff_private
      add constraint staff_private_phone_len_chk
      check (phone is null or char_length(phone) <= 20);
  end if;
end $$;

comment on table public.staff_private is
  'Date private ale specialistilor (telefon). Doar proprietarul business-ului; public doar prin get_public_staff_phones().';

alter table public.staff_private enable row level security;

-- Fara acces anon; acces explicit pentru authenticated (filtrat de RLS) si service_role.
revoke all on table public.staff_private from anon;
revoke all on table public.staff_private from public;
grant select, insert, update, delete on table public.staff_private to authenticated;
grant select, insert, update, delete on table public.staff_private to service_role;

drop policy if exists staff_private_owner_all on public.staff_private;
create policy staff_private_owner_all on public.staff_private
  for all
  to authenticated
  using (
    staff_id in (
      select s.id
      from public.staff s
      join public.business_profiles b on b.id = s.business_id
      where b.owner_user_id = auth.uid()
    )
  )
  with check (
    staff_id in (
      select s.id
      from public.staff s
      join public.business_profiles b on b.id = s.business_id
      where b.owner_user_id = auth.uid()
    )
  );

-- 3. Telefoanele publice pentru pagina /b (doar phone_public si staff activ)
create or replace function public.get_public_staff_phones(p_business_id uuid)
returns table (staff_id uuid, phone text)
language sql
stable
security definer
set search_path = public
as $$
  select sp.staff_id, sp.phone
  from public.staff_private sp
  join public.staff s on s.id = sp.staff_id
  where s.business_id = p_business_id
    and s.active = true
    and sp.phone_public = true
    and sp.phone is not null
    and length(trim(sp.phone)) > 0;
$$;

comment on function public.get_public_staff_phones(uuid) is
  'Telefoanele specialistilor activi marcate publice (pagina publica /b).';

revoke all on function public.get_public_staff_phones(uuid) from public;
revoke all on function public.get_public_staff_phones(uuid) from anon, authenticated;
grant execute on function public.get_public_staff_phones(uuid) to anon, authenticated;

notify pgrst, 'reload schema';