-- v16: dedicated client vs business accounts; sign out everyone; remove client users

alter table public.profiles
  add column if not exists account_kind text not null default 'client';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_account_kind_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_account_kind_chk
      check (account_kind in ('client', 'business'));
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, phone, display_name, account_kind)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data->>'display_name', null),
    case
      when new.raw_user_meta_data->>'account_kind' = 'business' then 'business'
      else 'client'
    end
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        phone = coalesce(excluded.phone, public.profiles.phone);
  return new;
end;
$$;

-- Keep remaining salon owners as business accounts.
update public.profiles p
set account_kind = 'business'
where exists (
  select 1 from public.business_profiles b where b.owner_user_id = p.id
);

-- Remove client activity (bookings belong to clients).
delete from public.appointments;
delete from public.waitlist;
delete from public.reviews;
delete from public.client_blocks;
delete from public.device_push_tokens;

-- Delete client auth users (not business owners). Cascades to profiles.
delete from auth.users
where id not in (
  select owner_user_id from public.business_profiles
);

-- Force every remaining user to log in again.
do $$
begin
  delete from auth.refresh_tokens;
exception
  when undefined_table then null;
end;
$$;

do $$
begin
  delete from auth.sessions;
exception
  when undefined_table then null;
end;
$$;
