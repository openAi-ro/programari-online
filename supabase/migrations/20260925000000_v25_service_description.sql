-- v25: important description on services (shown to clients at booking)
alter table public.services
  add column if not exists description text;

comment on column public.services.description is 'Important service description shown to clients.';
