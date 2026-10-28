-- v99 (3.02): business privat („Top secret”) + coduri de acces. Aditiv: nimic nu se
-- ascunde încă (RLS-ul vine în v100). Codurile se păstrează DOAR ca hash sha256.

alter table public.business_profiles
  add column if not exists is_private boolean not null default false;

-- Poarta unică pentru planul plătit de mai târziu. Acum: gratuit pentru toți.
create or replace function public.can_use_private_mode(p_business_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$ select p_business_id is not null; $$;

revoke all on function public.can_use_private_mode(uuid) from public;
grant execute on function public.can_use_private_mode(uuid) to authenticated, service_role;

create or replace function public.business_private_mode_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.is_private and (tg_op = 'INSERT' or not old.is_private)
     and not public.can_use_private_mode(new.id) then
    raise exception 'private_mode_unavailable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists business_private_mode_guard on public.business_profiles;
create trigger business_private_mode_guard
  before insert or update of is_private on public.business_profiles
  for each row execute function public.business_private_mode_guard();

create table if not exists public.business_access_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  code_hash text not null unique,
  code_hint text not null,
  label text check (label is null or char_length(label) <= 60),
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  used_count integer not null default 0 check (used_count >= 0 and used_count <= max_uses),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists business_access_codes_business_idx
  on public.business_access_codes(business_id, created_at desc);
alter table public.business_access_codes enable row level security;
-- Fără politici: doar prin RPC-urile de mai jos.

create table if not exists public.client_business_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  via_code_id uuid references public.business_access_codes(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, business_id)
);
create index if not exists client_business_access_business_idx
  on public.client_business_access(business_id);
alter table public.client_business_access enable row level security;
drop policy if exists client_business_access_select_own on public.client_business_access;
create policy client_business_access_select_own on public.client_business_access
  for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.access_code_attempts (
  id bigserial primary key,
  user_id uuid,
  ip text,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists access_code_attempts_user_idx on public.access_code_attempts(user_id, at);
create index if not exists access_code_attempts_ip_idx on public.access_code_attempts(ip, at);
alter table public.access_code_attempts enable row level security;

revoke all on public.business_access_codes, public.access_code_attempts from anon, authenticated;
revoke all on public.client_business_access from anon;
revoke insert, update, delete on public.client_business_access from authenticated;

-- Sursa unică a vizibilității: public, membru (owner/admin/staff) sau acces activ prin cod.
create or replace function public.business_visible_for(p_business_id uuid, p_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((
    select not b.is_private
        or (p_user_id is not null and (
              b.owner_user_id = p_user_id
           or exists (select 1 from public.business_members m
                       where m.business_id = b.id and m.user_id = p_user_id)
           or exists (select 1 from public.client_business_access a
                       where a.business_id = b.id and a.user_id = p_user_id
                         and a.revoked_at is null)))
      from public.business_profiles b
     where b.id = p_business_id
  ), false);
$$;
revoke all on function public.business_visible_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.business_visible_for(uuid, uuid) to service_role;

create or replace function public.business_visible(p_business_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$ select public.business_visible_for(p_business_id, (select auth.uid())); $$;
revoke all on function public.business_visible(uuid) from public;
grant execute on function public.business_visible(uuid) to anon, authenticated, service_role;

create or replace function public.require_business_manager(p_business_id uuid)
returns void
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null
     or coalesce(public.business_member_role(p_business_id)::text, '') not in ('owner', 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.require_business_manager(uuid) from public, anon, authenticated;

create or replace function public.normalize_access_code(p_code text)
returns text
language sql
immutable
as $$ select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); $$;

create or replace function public.create_business_access_code(
  p_business_id uuid,
  p_expires_at timestamptz,
  p_max_uses integer default 1,
  p_label text default null
)
returns table(id uuid, code text, expires_at timestamptz, max_uses integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  v_id uuid;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  i integer;
begin
  perform public.require_business_manager(p_business_id);
  if not public.can_use_private_mode(p_business_id) then
    raise exception 'private_mode_unavailable' using errcode = '42501';
  end if;
  if p_expires_at is null or p_expires_at < now() + interval '5 minutes'
     or p_expires_at > now() + interval '366 days' then
    raise exception 'bad_expiry';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 1000 then
    raise exception 'bad_uses';
  end if;
  if v_label is not null and char_length(v_label) > 60 then
    raise exception 'bad_label';
  end if;
  loop
    v_bytes := extensions.gen_random_bytes(24);
    v_code := '';
    -- Rejection sampling (248 = 8*31) → distribuție uniformă pe alfabet.
    for i in 0..23 loop
      exit when char_length(v_code) = 12;
      if get_byte(v_bytes, i) < 248 then
        v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
      end if;
    end loop;
    continue when char_length(v_code) < 12;
    begin
      insert into public.business_access_codes
        (business_id, code_hash, code_hint, label, max_uses, expires_at, created_by)
      values (p_business_id, encode(extensions.digest(v_code, 'sha256'), 'hex'),
              right(v_code, 4), v_label, p_max_uses, p_expires_at, auth.uid())
      returning business_access_codes.id into v_id;
      exit;
    exception when unique_violation then
      -- coliziune (practic imposibilă): încercăm din nou
    end;
  end loop;
  return query select v_id,
    substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4),
    p_expires_at, p_max_uses;
end;
$$;
revoke all on function public.create_business_access_code(uuid, timestamptz, integer, text) from public, anon;
grant execute on function public.create_business_access_code(uuid, timestamptz, integer, text) to authenticated;

create or replace function public.list_business_access_codes(p_business_id uuid)
returns table(id uuid, label text, code_hint text, max_uses integer, used_count integer,
              expires_at timestamptz, revoked_at timestamptz, created_at timestamptz, status text)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  perform public.require_business_manager(p_business_id);
  return query
    select c.id, c.label, c.code_hint, c.max_uses, c.used_count, c.expires_at, c.revoked_at,
           c.created_at,
           case when c.revoked_at is not null then 'revoked'
                when c.used_count >= c.max_uses then 'used'
                when c.expires_at <= now() then 'expired'
                else 'active' end
      from public.business_access_codes c
     where c.business_id = p_business_id
     order by c.created_at desc
     limit 200;
end;
$$;
revoke all on function public.list_business_access_codes(uuid) from public, anon;
grant execute on function public.list_business_access_codes(uuid) to authenticated;

create or replace function public.revoke_business_access_code(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_business uuid;
begin
  select c.business_id into v_business from public.business_access_codes c where c.id = p_code_id;
  perform public.require_business_manager(v_business);
  update public.business_access_codes set revoked_at = now()
   where id = p_code_id and revoked_at is null;
end;
$$;
revoke all on function public.revoke_business_access_code(uuid) from public, anon;
grant execute on function public.revoke_business_access_code(uuid) to authenticated;

create or replace function public.list_business_access_clients(p_business_id uuid)
returns table(user_id uuid, display_name text, email text, granted_at timestamptz)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  perform public.require_business_manager(p_business_id);
  return query
    select a.user_id, p.display_name, p.email, a.granted_at
      from public.client_business_access a
      left join public.profiles p on p.id = a.user_id
     where a.business_id = p_business_id and a.revoked_at is null
     order by a.granted_at desc
     limit 500;
end;
$$;
revoke all on function public.list_business_access_clients(uuid) from public, anon;
grant execute on function public.list_business_access_clients(uuid) to authenticated;

create or replace function public.revoke_business_client_access(p_business_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.require_business_manager(p_business_id);
  update public.client_business_access set revoked_at = now()
   where business_id = p_business_id and user_id = p_user_id and revoked_at is null;
end;
$$;
revoke all on function public.revoke_business_client_access(uuid, uuid) from public, anon;
grant execute on function public.revoke_business_client_access(uuid, uuid) to authenticated;

-- Răscumpărare: întoarce jsonb (nu aruncă) ca încercările eșuate să rămână înregistrate.
-- 5 eșecuri în 15 minute (per cont SAU per IP) → blocare temporară. Mesaj generic.
create or replace function public.redeem_business_access_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ip text := public.request_client_ip();
  v_norm text := public.normalize_access_code(p_code);
  v_fail integer;
  v_code_id uuid;
  v_business uuid;
  v_public_code text;
  v_name text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'auth_required');
  end if;
  delete from public.access_code_attempts where at < now() - interval '1 day';
  select count(*) into v_fail
    from public.access_code_attempts t
   where not t.ok and t.at > now() - interval '15 minutes'
     and (t.user_id = v_uid or (v_ip is not null and t.ip = v_ip));
  if v_fail >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  if char_length(v_norm) = 12 then
    update public.business_access_codes c
       set used_count = c.used_count + 1
     where c.code_hash = encode(extensions.digest(v_norm, 'sha256'), 'hex')
       and c.revoked_at is null
       and c.expires_at > now()
       and c.used_count < c.max_uses
    returning c.id, c.business_id into v_code_id, v_business;
  end if;

  if v_code_id is null then
    insert into public.access_code_attempts(user_id, ip, ok) values (v_uid, v_ip, false);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.access_code_attempts(user_id, ip, ok) values (v_uid, v_ip, true);
  insert into public.client_business_access(user_id, business_id, via_code_id)
  values (v_uid, v_business, v_code_id)
  on conflict (user_id, business_id) do update
     set revoked_at = null, granted_at = now(), via_code_id = excluded.via_code_id;
  insert into public.client_favorites(user_id, business_id)
  values (v_uid, v_business)
  on conflict do nothing;

  select b.public_code, b.name into v_public_code, v_name
    from public.business_profiles b where b.id = v_business;
  return jsonb_build_object('ok', true, 'public_code', v_public_code, 'name', v_name);
end;
$$;
revoke all on function public.redeem_business_access_code(text) from public, anon;
grant execute on function public.redeem_business_access_code(text) to authenticated;

-- „Programările mele”: datele de afișare ale business-urilor unde clientul are programări,
-- inclusiv cele devenite private (programările existente rămân vizibile și anulabile).
create or replace function public.my_appointment_businesses()
returns table(id uuid, name text, public_code text, timezone text, address text, city text,
              county text, maps_url text, latitude double precision, longitude double precision,
              cancel_notice_minutes integer, google_review_url text, is_private boolean)
language sql
stable security definer
set search_path to 'public'
as $$
  select b.id, b.name, b.public_code, b.timezone, b.address, b.city, b.county, b.maps_url,
         b.latitude, b.longitude, b.cancel_notice_minutes, b.google_review_url, b.is_private
    from public.business_profiles b
   where exists (select 1 from public.appointments a
                  where a.business_id = b.id and a.client_user_id = (select auth.uid()));
$$;
revoke all on function public.my_appointment_businesses() from public, anon;
grant execute on function public.my_appointment_businesses() to authenticated;
