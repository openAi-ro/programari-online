-- v43: pachete de sedinte (evidenta manuala), carduri cadou (evidenta manuala),
-- link recenzie Google per business. Fara plati online: firma emite si marcheaza.

alter table public.business_profiles
  add column if not exists google_review_url text;

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  name text not null,
  sessions int not null check (sessions > 0),
  price numeric(10, 2) not null default 0 check (price >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.client_packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null,
  package_id uuid not null references public.packages(id) on delete cascade,
  sessions_total int not null check (sessions_total > 0),
  sessions_used int not null default 0 check (sessions_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  code text not null,
  amount numeric(10, 2) not null check (amount > 0),
  balance numeric(10, 2) not null check (balance >= 0),
  recipient_name text,
  status text not null default 'active' check (status in ('active', 'redeemed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code)
);

create index if not exists packages_business_idx on public.packages (business_id, active, sort_order);
create index if not exists client_packages_client_idx on public.client_packages (client_user_id, business_id);
create index if not exists gift_cards_business_idx on public.gift_cards (business_id, created_at desc);

alter table public.packages enable row level security;
alter table public.client_packages enable row level security;
alter table public.gift_cards enable row level security;

drop policy if exists packages_owner_all on public.packages;
create policy packages_owner_all on public.packages
  for all to authenticated
  using (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id))
  with check (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id));

drop policy if exists packages_client_select on public.packages;
create policy packages_client_select on public.packages
  for select to authenticated
  using (
    auth.uid() in (
      select client_user_id from public.client_packages cp where cp.package_id = packages.id
    )
  );

drop policy if exists client_packages_owner_all on public.client_packages;
create policy client_packages_owner_all on public.client_packages
  for all to authenticated
  using (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id))
  with check (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id));

drop policy if exists client_packages_client_select on public.client_packages;
create policy client_packages_client_select on public.client_packages
  for select to authenticated
  using (client_user_id = auth.uid());

drop policy if exists gift_cards_owner_all on public.gift_cards;
create policy gift_cards_owner_all on public.gift_cards
  for all to authenticated
  using (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id))
  with check (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id));

grant select, insert, update, delete on public.packages to authenticated;
grant select, insert, update, delete on public.client_packages to authenticated;
grant select, insert, update, delete on public.gift_cards to authenticated;

-- Clientul verifica un card dupa cod exact, fara sa vada lista firmei.
create or replace function public.check_gift_card(p_code text)
returns table (business_name text, balance numeric(10, 2), status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select b.name, g.balance, g.status
  from public.gift_cards g
  join public.business_profiles b on b.id = g.business_id
  where g.code = upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'))
  limit 1;
end;
$$;

revoke all on function public.check_gift_card(text) from public;
grant execute on function public.check_gift_card(text) to anon, authenticated;

notify pgrst, 'reload schema';
