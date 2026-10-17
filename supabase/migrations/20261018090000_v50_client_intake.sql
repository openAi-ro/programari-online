-- v50: fisa inainte de vizita (alergii, afectiuni, acord foto) + poze inainte/dupa
create table if not exists public.client_intake (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null,
  allergies text not null default '',
  conditions text not null default '',
  photo_consent boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, client_user_id)
);

create table if not exists public.client_photos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null,
  url text not null,
  kind text not null default 'before' check (kind in ('before', 'after')),
  created_at timestamptz not null default now()
);

create index if not exists client_photos_client_idx
  on public.client_photos (business_id, client_user_id, created_at desc);

alter table public.client_intake enable row level security;
alter table public.client_photos enable row level security;

drop policy if exists intake_owner_all on public.client_intake;
create policy intake_owner_all on public.client_intake
  for all to authenticated
  using (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id))
  with check (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id));

drop policy if exists intake_client_rw on public.client_intake;
create policy intake_client_rw on public.client_intake
  for all to authenticated
  using (client_user_id = auth.uid())
  with check (client_user_id = auth.uid());

drop policy if exists photos_owner_all on public.client_photos;
create policy photos_owner_all on public.client_photos
  for all to authenticated
  using (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id))
  with check (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id));

drop policy if exists photos_client_select on public.client_photos;
create policy photos_client_select on public.client_photos
  for select to authenticated
  using (client_user_id = auth.uid());

grant select, insert, update, delete on public.client_intake to authenticated;
grant select, insert, update, delete on public.client_photos to authenticated;

notify pgrst, 'reload schema';
