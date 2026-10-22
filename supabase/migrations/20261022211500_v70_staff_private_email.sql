-- v70: email privat al specialistului in public.staff_private.
-- Optional (NULL). Aplicatia trimite emailul fara spatii si cu litere mici;
-- check-ul din DB respinge orice altceva. Acces: aceleasi RLS/grant-uri ca in
-- v65/v67 (doar proprietarul business-ului; anon nu are acces la tabel).
-- Scop ulterior: invitatie pe email ca specialistul sa-si conecteze Google Calendar.
-- Idempotenta.

alter table public.staff_private add column if not exists email text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_private_email_chk'
  ) then
    alter table public.staff_private
      add constraint staff_private_email_chk
      check (
        email is null
        or (
          char_length(email) <= 254
          and email = lower(btrim(email))
          and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
      );
  end if;
end $$;

comment on column public.staff_private.email is
  'Email privat al specialistului (optional, litere mici). Doar proprietarul business-ului il vede.';

comment on table public.staff_private is
  'Date private ale specialistilor (telefon, email). Doar proprietarul business-ului; public doar telefonul prin get_public_staff_phones().';

notify pgrst, 'reload schema';
