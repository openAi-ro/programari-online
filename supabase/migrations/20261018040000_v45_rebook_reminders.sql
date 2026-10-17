-- v45: reminder de revenire pe ritmul serviciului
-- Firma seteaza intervalul (zile) per serviciu; 0/null = oprit.
alter table public.services
  add column if not exists rebook_interval_days int;

alter table public.appointments
  add column if not exists rebook_reminded boolean not null default false;
