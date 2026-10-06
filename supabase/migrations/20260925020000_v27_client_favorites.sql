-- v27: favorite cloud (client_favorites) + snippet public de recenzii.
-- NU rula db push din acest task — Rafael aplică migrarea pe Supabase când e gata.
-- App-ul păstrează cache local (AsyncStorage) și face sync best-effort.

-- ---------------------------------------------------------------------------
-- client_favorites
-- ---------------------------------------------------------------------------
create table if not exists public.client_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

create index if not exists client_favorites_user_idx
  on public.client_favorites (user_id, created_at desc);

create index if not exists client_favorites_business_idx
  on public.client_favorites (business_id);

alter table public.client_favorites enable row level security;

drop policy if exists client_favorites_select_own on public.client_favorites;
create policy client_favorites_select_own on public.client_favorites
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists client_favorites_insert_own on public.client_favorites;
create policy client_favorites_insert_own on public.client_favorites
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists client_favorites_delete_own on public.client_favorites;
create policy client_favorites_delete_own on public.client_favorites
  for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.client_favorites to authenticated;

-- ---------------------------------------------------------------------------
-- list_public_reviews — snippet fără PII (rating + comentariu), pentru profil salon
-- ---------------------------------------------------------------------------
create or replace function public.list_public_reviews(
  p_business_id uuid,
  p_limit int default 3
)
returns table (
  rating int,
  comment text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.rating,
    left(coalesce(r.comment, ''), 160) as comment,
    r.created_at
  from public.reviews r
  where r.business_id = p_business_id
    and r.rating between 1 and 5
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 10));
$$;

comment on function public.list_public_reviews(uuid, int) is
  'Snippet public de recenzii (fără PII) pentru profilul salonului.';

revoke all on function public.list_public_reviews(uuid, int) from public;
grant execute on function public.list_public_reviews(uuid, int) to anon, authenticated;

notify pgrst, 'reload schema';
