-- v101 (3.03): programare rapidă din business — clienți doar cu telefon, multi-serviciu.
-- ADITIV și compatibil cu 3.02 live: nu modifică / nu șterge business_create_walkin,
-- search_business_clients, list_business_clients sau alte RPC-uri existente.
-- Rollback: supabase/rollback/v101_rollback.sql. Curățarea (drop walk-in vechi, fix
-- walk-in legate de owner) e în v102, aplicată separat doar după OK.

-- 1) Normalizare telefon pe server (oglindă lib/phone.ts normalizePhoneE164, default +40).
create or replace function public.normalize_phone_e164(p_raw text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  d text;
begin
  if p_raw is null or btrim(p_raw) = '' then
    return null;
  end if;
  d := regexp_replace(p_raw, '[^0-9]', '', 'g');
  if left(d, 2) = '00' then d := substr(d, 3); end if;
  if left(d, 1) = '0' and length(d) >= 10 then d := '40' || substr(d, 2); end if;
  if left(d, 2) <> '40' and length(d) = 9 and left(d, 1) = '7' then d := '40' || d; end if;
  if length(d) < 10 or length(d) > 15 then
    return null;
  end if;
  return '+' || d;
end;
$$;

-- 2) Fișa de client a business-ului (poate exista fără cont).
create table if not exists public.business_clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  name text,
  phone_e164 text,
  phone_key text generated always as (public.guest_phone_key(phone_e164)) stored,
  email text,
  user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_clients_contact_chk
    check (phone_e164 is not null or email is not null or user_id is not null),
  constraint business_clients_name_len check (name is null or char_length(name) <= 120)
);

create unique index if not exists business_clients_phone_uniq
  on public.business_clients (business_id, phone_key) where phone_key is not null;
create unique index if not exists business_clients_email_uniq
  on public.business_clients (business_id, lower(email)) where email is not null and phone_key is null;
create unique index if not exists business_clients_user_uniq
  on public.business_clients (business_id, user_id) where user_id is not null;

alter table public.business_clients enable row level security;
revoke all on public.business_clients from anon;
grant select on public.business_clients to authenticated;

-- 3) Coloane noi pe programări (toate nullable / cu default → inserările 3.02 merg neschimbate).
alter table public.appointments
  add column if not exists business_client_id uuid references public.business_clients(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists notify_client boolean,
  add column if not exists business_note text;

create index if not exists appointments_business_client_idx
  on public.appointments (business_client_id) where business_client_id is not null;

comment on column public.appointments.notify_client is
  'v101: null = programare făcută de client (preferințele lui); false/true = creată de business, clientul primește mesaje doar dacă true.';

drop policy if exists business_clients_select_member on public.business_clients;
create policy business_clients_select_member on public.business_clients
  for select to authenticated
  using (
    public.business_member_role(business_id) in ('owner', 'admin')
    or (
      public.business_member_role(business_id) = 'staff'
      and exists (
        select 1 from public.appointments a
         where a.business_client_id = business_clients.id
           and a.staff_id = public.business_member_staff_id(business_clients.business_id)
      )
    )
  );

-- 4) RPC: business creează programarea (multi-serviciu, client cu/fără cont).
create or replace function public.business_create_appointment(
  p_business_id uuid,
  p_start_at timestamptz,
  p_service_ids uuid[],
  p_staff_id uuid default null,
  p_client_id uuid default null,
  p_client_user_id uuid default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_client_email text default null,
  p_note text default null,
  p_notify_client boolean default false
)
returns public.appointments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_role text := public.business_member_role(p_business_id);
  v_my_staff uuid := public.business_member_staff_id(p_business_id);
  v_biz public.business_profiles;
  v_staff_id uuid;
  v_staff_name text;
  v_found int;
  v_svc_name text;
  v_duration int;
  v_price numeric(10, 2);
  v_end timestamptz;
  v_local_date text;
  v_name text;
  v_phone text;
  v_email text;
  v_client public.business_clients;
  v_notify boolean := coalesce(p_notify_client, false);
  v_row public.appointments;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_biz from public.business_profiles where id = p_business_id;
  if not found then
    raise exception 'business_not_found';
  end if;
  if v_role is null then
    raise exception 'not_business_owner';
  end if;
  if v_role = 'staff' then
    if v_my_staff is null then raise exception 'staff_not_linked'; end if;
    if p_staff_id is not null and p_staff_id <> v_my_staff then
      raise exception 'staff_own_only';
    end if;
    p_staff_id := v_my_staff;
  end if;

  if p_service_ids is null or cardinality(p_service_ids) = 0 then
    raise exception 'service_not_found';
  end if;

  if p_staff_id is not null then
    select id, name into v_staff_id, v_staff_name
      from public.staff
     where id = p_staff_id and business_id = p_business_id and active = true;
    if not found then
      raise exception 'staff_not_found';
    end if;
    if not public.staff_offers_services(v_staff_id, p_service_ids) then
      raise exception 'staff_service_mismatch';
    end if;
  else
    select id, name into v_staff_id, v_staff_name
      from public.staff
     where business_id = p_business_id and active = true
       and public.staff_offers_services(id, p_service_ids)
     order by sort_order, created_at
     limit 1;
    if not found and exists (
      select 1 from public.staff where business_id = p_business_id and active = true
    ) then
      raise exception 'staff_service_mismatch';
    end if;
  end if;

  select count(*),
         string_agg(s.name, ' + ' order by u.ord),
         sum(s.duration_minutes)::int,
         sum(s.price)
    into v_found, v_svc_name, v_duration, v_price
    from unnest(p_service_ids) with ordinality as u(sid, ord)
    join public.services s
      on s.id = u.sid and s.business_id = p_business_id and s.active = true;
  if v_found <> cardinality(p_service_ids) then
    raise exception 'service_not_found';
  end if;

  v_end := p_start_at + make_interval(mins => v_duration);
  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;
  -- Business poate nota și programări trecute (fără too_soon), dar nu mai vechi de 1 an.
  if p_start_at < now() - interval '365 days' then
    raise exception 'too_far_past';
  end if;
  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;
  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  -- Client: fișă existentă, cont existent al salonului, sau nou din telefon/email.
  v_name := left(nullif(btrim(coalesce(p_client_name, '')), ''), 120);
  v_phone := public.normalize_phone_e164(p_client_phone);
  if nullif(btrim(coalesce(p_client_phone, '')), '') is not null and v_phone is null then
    raise exception 'invalid_phone';
  end if;
  v_email := lower(nullif(btrim(coalesce(p_client_email, '')), ''));
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  if p_client_id is not null then
    select * into v_client from public.business_clients
     where id = p_client_id and business_id = p_business_id;
    if not found then
      raise exception 'client_not_found';
    end if;
  elsif p_client_user_id is not null then
    if p_client_user_id = v_biz.owner_user_id
       or exists (select 1 from public.business_members m
                   where m.business_id = p_business_id and m.user_id = p_client_user_id)
       or not exists (select 1 from public.appointments a
                       where a.business_id = p_business_id and a.client_user_id = p_client_user_id) then
      raise exception 'client_not_found';
    end if;
    select * into v_client from public.business_clients
     where business_id = p_business_id and user_id = p_client_user_id;
    if not found then
      select coalesce(v_phone, public.normalize_phone_e164(nullif(p.phone, ''))),
             coalesce(v_email, lower(nullif(p.email, ''))),
             coalesce(v_name, nullif(p.display_name, ''))
        into v_phone, v_email, v_name
        from public.profiles p where p.id = p_client_user_id;
      if v_phone is null and v_email is null then
        select public.normalize_phone_e164(a.client_phone), lower(nullif(a.client_email, ''))
          into v_phone, v_email
          from public.appointments a
         where a.business_id = p_business_id and a.client_user_id = p_client_user_id
         order by a.start_at desc limit 1;
      end if;
      -- telefonul poate fi deja pe o fișă fără cont: o legăm de cont.
      if v_phone is not null then
        select * into v_client from public.business_clients
         where business_id = p_business_id and phone_key = public.guest_phone_key(v_phone)
           and user_id is null;
      end if;
      if v_client.id is not null then
        update public.business_clients
           set user_id = p_client_user_id, updated_at = now()
         where id = v_client.id
        returning * into v_client;
      else
        insert into public.business_clients (business_id, name, phone_e164, email, user_id, created_by)
        values (p_business_id, v_name, v_phone, case when v_phone is null then v_email else v_email end,
                p_client_user_id, v_user)
        returning * into v_client;
      end if;
    end if;
  else
    if v_phone is null and v_email is null then
      raise exception 'walkin_contact_required';
    end if;
    if v_phone is not null then
      select * into v_client from public.business_clients
       where business_id = p_business_id and phone_key = public.guest_phone_key(v_phone);
    end if;
    if v_client.id is null and v_email is not null and v_phone is null then
      select * into v_client from public.business_clients
       where business_id = p_business_id and lower(email) = v_email
       order by (phone_key is null) desc, created_at
       limit 1;
    end if;
    if v_client.id is null then
      insert into public.business_clients (business_id, name, phone_e164, email, created_by)
      values (p_business_id, v_name, v_phone, v_email, v_user)
      on conflict do nothing
      returning * into v_client;
      if v_client.id is null then
        -- cursă: altcineva a creat fișa între timp
        select * into v_client from public.business_clients
         where business_id = p_business_id
           and ((v_phone is not null and phone_key = public.guest_phone_key(v_phone))
             or (v_phone is null and lower(email) = v_email))
         limit 1;
      end if;
    else
      update public.business_clients
         set name = coalesce(name, v_name),
             email = coalesce(email, v_email),
             updated_at = now()
       where id = v_client.id
      returning * into v_client;
    end if;
  end if;

  v_phone := coalesce(v_phone, v_client.phone_e164);
  v_email := coalesce(v_email, v_client.email);
  v_name := coalesce(v_name, v_client.name);
  if v_phone is null and v_email is null then
    raise exception 'walkin_contact_required';
  end if;

  -- Programare deja trecută: niciun mesaj către client, indiferent de toggle.
  if v_end < now() then
    v_notify := false;
  end if;

  perform public.assert_slot_free(p_business_id, v_staff_id, p_start_at, v_end,
                                  coalesce(v_biz.buffer_minutes, 0));

  insert into public.appointments (
    business_id, client_user_id, start_at, end_at, status,
    client_email, client_phone, guest_name,
    service_id, service_ids, service_name, service_duration_minutes, service_price,
    payment_status, deposit_ron,
    staff_id, staff_name,
    decision_notified, reminder_sent, reminder_24h_sent, attendance_confirmed,
    business_client_id, created_by, notify_client, business_note
  ) values (
    p_business_id, v_client.user_id, p_start_at, v_end, 'approved',
    v_email, v_phone, v_name,
    p_service_ids[1], p_service_ids, v_svc_name, v_duration, v_price,
    'none', 0,
    v_staff_id, v_staff_name,
    -- toggle OFF: marcăm confirmarea și reminderele ca „gata", ca nici send-reminders
    -- 3.02 (încă nemodificat pe server) să nu trimită nimic.
    not v_notify, not v_notify, not v_notify, false,
    v_client.id, v_user, v_notify, left(nullif(btrim(coalesce(p_note, '')), ''), 500)
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.business_create_appointment(uuid, timestamptz, uuid[], uuid, uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.business_create_appointment(uuid, timestamptz, uuid[], uuid, uuid, uuid, text, text, text, text, boolean) to authenticated;

-- 5) Căutare client pentru programare rapidă (fișe + conturi). Staff: doar clienții proprii.
create or replace function public.search_business_client_contacts(p_business_id uuid, p_query text)
returns table(business_client_id uuid, client_user_id uuid, display_name text,
              phone text, email text, visit_count bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := public.business_member_role(p_business_id);
  v_my_staff uuid := public.business_member_staff_id(p_business_id);
  v_owner uuid;
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_digits text := regexp_replace(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '^(40|0)+', '');
begin
  if v_role is null or char_length(v_q) < 2 then
    return;
  end if;
  if char_length(v_digits) < 3 then
    v_digits := null;
  end if;
  select owner_user_id into v_owner from public.business_profiles where id = p_business_id;

  return query
  select * from (
    select bc.id, bc.user_id,
           coalesce(bc.name, p.display_name),
           bc.phone_e164, bc.email,
           (select count(*) from public.appointments a
             where a.business_client_id = bc.id and a.status = 'approved' and a.start_at < now())
      from public.business_clients bc
      left join public.profiles p on p.id = bc.user_id
     where bc.business_id = p_business_id
       and (v_role in ('owner', 'admin') or exists (
             select 1 from public.appointments a
              where a.business_client_id = bc.id and a.staff_id = v_my_staff))
       and (position(v_q in lower(coalesce(bc.name, p.display_name, ''))) > 0
         or position(v_q in lower(coalesce(bc.email, ''))) > 0
         or (v_digits is not null and position(v_digits in regexp_replace(coalesce(bc.phone_e164, ''), '\D', '', 'g')) > 0))
    union all
    select null::uuid, a.client_user_id,
           max(p.display_name),
           max(coalesce(nullif(a.client_phone, ''), nullif(p.phone, ''))),
           max(coalesce(nullif(a.client_email, ''), nullif(p.email, ''))),
           count(*) filter (where a.status = 'approved' and a.start_at < now())
      from public.appointments a
      left join public.profiles p on p.id = a.client_user_id
     where a.business_id = p_business_id
       and a.client_user_id is not null
       and a.client_user_id <> v_owner
       and not exists (select 1 from public.business_members m
                        where m.business_id = p_business_id and m.user_id = a.client_user_id)
       and not exists (select 1 from public.business_clients bc
                        where bc.business_id = p_business_id and bc.user_id = a.client_user_id)
       and (v_role in ('owner', 'admin') or a.staff_id = v_my_staff)
     group by a.client_user_id
    having position(v_q in lower(coalesce(max(p.display_name), ''))) > 0
        or position(v_q in lower(coalesce(max(a.client_email), max(p.email), ''))) > 0
        or (v_digits is not null and position(v_digits in regexp_replace(
              coalesce(max(a.client_phone), max(p.phone), ''), '\D', '', 'g')) > 0)
  ) r
  order by 6 desc, 3 nulls last
  limit 10;
end;
$$;

revoke all on function public.search_business_client_contacts(uuid, text) from public, anon;
grant execute on function public.search_business_client_contacts(uuid, text) to authenticated;

-- 6) Clienți fără cont (doar fișă) pentru tab-ul Clienți. Owner/admin.
create or replace function public.list_business_contact_clients()
returns table(business_client_id uuid, business_id uuid, display_name text, phone text,
              email text, visit_count bigint, last_start_at timestamptz, upcoming_count bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select bc.id, bc.business_id, bc.name, bc.phone_e164, bc.email,
         count(a.id) filter (where a.status = 'approved' and a.start_at < now()),
         max(a.start_at) filter (where a.status = 'approved' and a.start_at < now()),
         count(a.id) filter (where a.status in ('pending', 'approved') and a.start_at >= now())
    from public.business_clients bc
    left join public.appointments a on a.business_client_id = bc.id
   where bc.user_id is null
     and public.business_member_role(bc.business_id) in ('owner', 'admin')
   group by bc.id
   order by max(a.start_at) desc nulls last, bc.created_at desc;
$$;

revoke all on function public.list_business_contact_clients() from public, anon;
grant execute on function public.list_business_contact_clients() to authenticated;

-- 7) Backfill: fișe din programările guest existente (client_user_id null).
-- NU atinge Rafael/Frizerie (v35hit4q8j) și Ionut Barbershop (zt0a7cr372); walk-in-urile
-- legate de owner se tratează în v102.
insert into public.business_clients (business_id, name, phone_e164, email, created_at)
select distinct on (a.business_id, coalesce(public.guest_phone_key(a.client_phone), lower(btrim(a.client_email))))
       a.business_id,
       left(nullif(btrim(a.guest_name), ''), 120),
       public.normalize_phone_e164(a.client_phone),
       lower(nullif(btrim(a.client_email), '')),
       a.created_at
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
 where a.client_user_id is null
   and b.public_code not in ('v35hit4q8j', 'zt0a7cr372')
   and (public.normalize_phone_e164(a.client_phone) is not null or nullif(btrim(a.client_email), '') is not null)
 order by a.business_id,
          coalesce(public.guest_phone_key(a.client_phone), lower(btrim(a.client_email))),
          a.start_at desc
on conflict do nothing;

update public.appointments a
   set business_client_id = bc.id
  from public.business_clients bc, public.business_profiles b
 where b.id = a.business_id
   and b.public_code not in ('v35hit4q8j', 'zt0a7cr372')
   and a.client_user_id is null
   and a.business_client_id is null
   and bc.business_id = a.business_id
   and bc.user_id is null
   and (
     (bc.phone_key is not null and bc.phone_key = public.guest_phone_key(a.client_phone))
     or (public.guest_phone_key(a.client_phone) is null and bc.phone_key is null
         and lower(bc.email) = lower(btrim(a.client_email)))
   );
