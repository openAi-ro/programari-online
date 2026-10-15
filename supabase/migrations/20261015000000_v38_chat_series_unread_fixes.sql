-- v38: reparari chat / invitat / recurente / recenzii
-- 1) Triggerul de chat nu mai rupe rezervarile guest (client_user_id null).
-- 2) RPC business->client pentru mesajul rapid din Cereri.
-- 3) Stergerea unei programari NU mai sterge conversatia cu clientul.
-- 4) Chat: coloane last-read + RPC-uri pentru necitite si marcare citit.
-- 5) Recenzii: raspuns al business-ului (owner_reply) + RPC reply_to_review.
-- 6) Recurente: recurring_series_id pe serie + anulare serie.

-- 1) -----------------------------------------------------------------------
create or replace function public.chat_conversation_from_appointment() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Invitatii si walk-in-urile fara cont nu au conversatie de chat.
  if NEW.client_user_id is null then
    return NEW;
  end if;
  insert into public.chat_conversations (business_id, client_user_id)
  values (NEW.business_id, NEW.client_user_id)
  on conflict (business_id, client_user_id) do nothing;
  return NEW;
end;
$$;

-- 2) -----------------------------------------------------------------------
-- Conversatia dintre business-ul apelantului (owner) si un client anume.
create or replace function public.ensure_chat_conversation_for_client(
  p_business_id uuid,
  p_client_user_id uuid
) returns public.chat_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_conv public.chat_conversations;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_client_user_id is null then
    raise exception 'no_client_account';
  end if;
  if p_client_user_id = v_user then
    raise exception 'self_conversation';
  end if;
  if not exists (
    select 1 from public.business_profiles
    where id = p_business_id and owner_user_id = v_user
  ) then
    raise exception 'not_owner';
  end if;

  insert into public.chat_conversations (business_id, client_user_id)
  values (p_business_id, p_client_user_id)
  on conflict (business_id, client_user_id) do nothing;

  select * into v_conv from public.chat_conversations
    where business_id = p_business_id and client_user_id = p_client_user_id;
  if not found then
    raise exception 'conversation_not_created';
  end if;
  return v_conv;
end;
$$;

revoke all on function public.ensure_chat_conversation_for_client(uuid, uuid) from public;
grant execute on function public.ensure_chat_conversation_for_client(uuid, uuid) to authenticated;

-- 3) -----------------------------------------------------------------------
-- Aceeasi semnatura ca v21, dar conversatia si mesajele raman intacte.
create or replace function public.delete_appointment_and_chats(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_app public.appointments;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_app from public.appointments where id = p_appointment_id;
  if not found then raise exception 'appointment_not_found'; end if;
  if not exists (
    select 1 from public.business_profiles b
    where b.id = v_app.business_id and b.owner_user_id = v_user
  ) then
    raise exception 'not_owner';
  end if;

  delete from public.appointments where id = p_appointment_id;
  return jsonb_build_object('deleted_appointment', p_appointment_id, 'deleted_chats', 0);
end;
$$;

revoke all on function public.delete_appointment_and_chats(uuid) from public;
grant execute on function public.delete_appointment_and_chats(uuid) to authenticated;

-- 4) -----------------------------------------------------------------------
alter table public.chat_conversations
  add column if not exists client_last_read_at timestamptz,
  add column if not exists owner_last_read_at timestamptz;

create or replace function public.mark_chat_conversation_read(
  p_conversation uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_conv public.chat_conversations;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_conv from public.chat_conversations where id = p_conversation;
  if not found then raise exception 'conversation_not_found'; end if;

  if v_conv.client_user_id = v_user then
    update public.chat_conversations
      set client_last_read_at = now() where id = p_conversation;
  elsif exists (
    select 1 from public.business_profiles b
    where b.id = v_conv.business_id and b.owner_user_id = v_user
  ) then
    update public.chat_conversations
      set owner_last_read_at = now() where id = p_conversation;
  else
    raise exception 'not_participant';
  end if;
end;
$$;

revoke all on function public.mark_chat_conversation_read(uuid) from public;
grant execute on function public.mark_chat_conversation_read(uuid) to authenticated;

create or replace function public.chat_unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, count(m.id)
  from public.chat_conversations c
  left join public.chat_messages m
    on m.conversation_id = c.id
   and m.sender_user_id <> auth.uid()
   and m.created_at > coalesce(
     case
       when c.client_user_id = auth.uid() then c.client_last_read_at
       else c.owner_last_read_at
     end,
     '-infinity'::timestamptz
   )
  where auth.uid() is not null
    and (
      c.client_user_id = auth.uid()
      or c.business_id in (
        select id from public.business_profiles b where b.owner_user_id = auth.uid()
      )
    )
  group by c.id;
$$;

revoke all on function public.chat_unread_counts() from public;
grant execute on function public.chat_unread_counts() to authenticated;

-- 5) -----------------------------------------------------------------------
alter table public.reviews
  add column if not exists owner_reply text,
  add column if not exists owner_reply_at timestamptz;

create or replace function public.reply_to_review(
  p_review_id uuid,
  p_reply text
) returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.reviews;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_reply is null or trim(p_reply) = '' then raise exception 'empty_reply'; end if;
  if length(p_reply) > 1000 then raise exception 'reply_too_long'; end if;

  update public.reviews r
  set owner_reply = trim(p_reply), owner_reply_at = now()
  where r.id = p_review_id
    and v_user in (
      select owner_user_id from public.business_profiles b where b.id = r.business_id
    )
  returning * into v_row;

  if v_row is null then raise exception 'cannot_reply'; end if;
  return v_row;
end;
$$;

revoke all on function public.reply_to_review(uuid, text) from public;
grant execute on function public.reply_to_review(uuid, text) to authenticated;

drop function if exists public.list_public_reviews(uuid, int);
create or replace function public.list_public_reviews(
  p_business_id uuid,
  p_limit int default 3
)
returns table (
  rating int,
  comment text,
  created_at timestamptz,
  owner_reply text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.rating,
    left(coalesce(r.comment, ''), 160) as comment,
    r.created_at,
    left(coalesce(r.owner_reply, ''), 160) as owner_reply
  from public.reviews r
  where r.business_id = p_business_id
    and r.rating between 1 and 5
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 10));
$$;

revoke all on function public.list_public_reviews(uuid, int) from public;
grant execute on function public.list_public_reviews(uuid, int) to anon, authenticated;

-- 6) -----------------------------------------------------------------------
alter table public.appointments
  add column if not exists recurring_series_id uuid;
create index if not exists appointments_recurring_series_idx
  on public.appointments (recurring_series_id);

create or replace function public.cancel_recurring_series(
  p_series_id uuid
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count int := 0;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_series_id is null then raise exception 'series_required'; end if;

  update public.appointments a
  set status = 'cancelled', updated_at = now()
  where a.recurring_series_id = p_series_id
    and a.start_at >= now()
    and a.status in ('pending', 'approved')
    and (
      a.client_user_id = v_user
      or v_user in (
        select owner_user_id from public.business_profiles b where b.id = a.business_id
      )
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cancel_recurring_series(uuid) from public;
grant execute on function public.cancel_recurring_series(uuid) to authenticated;

-- Seriile noi primesc un recurring_series_id comun (corpul functiei e cel
-- din v36, cu seria adaugata la insert).
create or replace function public.create_recurring_appointments(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_service_id uuid default null,
  p_staff_id uuid default null,
  p_repeat_count int default 2
) returns setof public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_duration int;
  v_buffer int;
  v_status public.appointment_status;
  v_deposit numeric(10, 2);
  v_pay text;
  v_staff_id uuid;
  v_staff_name text;
  v_count int;
  v_i int;
  v_slot timestamptz;
  v_end timestamptz;
  v_local_date text;
  v_row public.appointments;
  v_series uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  v_count := greatest(2, least(coalesce(p_repeat_count, 2), 8));

  insert into public.profiles (id, email, phone)
  select
    v_user,
    nullif(u.email, ''),
    nullif(u.phone, '')
  from auth.users u
  where u.id = v_user
  on conflict (id) do update
    set email = coalesce(nullif(public.profiles.email, ''), excluded.email),
        phone = coalesce(nullif(public.profiles.phone, ''), excluded.phone);

  select nullif(trim(email), ''), nullif(trim(phone), '')
    into v_email, v_phone
    from public.profiles
    where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  if exists (
    select 1 from public.client_blocks
    where business_id = p_business_id and client_user_id = v_user
  ) then
    raise exception 'client_blocked';
  end if;

  select * into v_biz from public.business_profiles where id = p_business_id;
  if not found then
    raise exception 'business_not_found';
  end if;

  if p_staff_id is not null then
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where id = p_staff_id and business_id = p_business_id and active = true;
    if not found then
      raise exception 'staff_not_found';
    end if;
  else
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
    order by sort_order, created_at
    limit 1;
  end if;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := coalesce(v_biz.session_duration_minutes, 30);
  v_deposit := coalesce(v_biz.deposit_ron, 0);
  v_pay := case when v_deposit > 0 then 'unpaid' else 'none' end;
  v_status := 'pending';

  if coalesce(v_biz.auto_approve_returning, false)
     and exists (
       select 1 from public.appointments
       where business_id = p_business_id
         and client_user_id = v_user
         and status = 'approved'
     )
  then
    v_status := 'approved';
  end if;

  if p_service_id is not null then
    select id, name, duration_minutes, price
    into v_svc_id, v_svc_name, v_svc_duration, v_svc_price
    from public.services
    where id = p_service_id
      and business_id = p_business_id
      and active = true;
    if not found then
      raise exception 'service_not_found';
    end if;
    v_duration := v_svc_duration;
  end if;

  for v_i in 0..(v_count - 1) loop
    v_slot := p_start_at + make_interval(weeks => v_i);
    v_end := v_slot + make_interval(mins => v_duration);

    if v_i = 0 and v_slot < now() + make_interval(mins => coalesce(v_biz.min_notice_minutes, 0)) then
      raise exception 'too_soon';
    end if;

    if v_slot > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
      raise exception 'too_far';
    end if;

    v_local_date := to_char((timezone(v_biz.timezone, v_slot))::date, 'YYYY-MM-DD');
    if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
      raise exception 'day_blocked';
    end if;

    if exists (
      select 1 from public.appointments
      where business_id = p_business_id
        and staff_id is not distinct from v_staff_id
        and public.appointment_blocks_slot(status)
        and start_at < public.busy_end_with_buffer(v_end, v_buffer)
        and public.busy_end_with_buffer(end_at, v_buffer) > v_slot
    ) then
      raise exception 'slot_taken';
    end if;
  end loop;

  for v_i in 0..(v_count - 1) loop
    v_slot := p_start_at + make_interval(weeks => v_i);
    v_end := v_slot + make_interval(mins => v_duration);

    insert into public.appointments (
      business_id, client_user_id, start_at, end_at, status,
      client_email, client_phone,
      service_id, service_name, service_duration_minutes, service_price,
      payment_status, deposit_ron,
      staff_id, staff_name, loyalty_redeemed, recurring_series_id
    ) values (
      p_business_id, v_user, v_slot, v_end, v_status,
      v_email, v_phone,
      v_svc_id, v_svc_name, v_duration, v_svc_price,
      v_pay, v_deposit,
      v_staff_id, v_staff_name, false, v_series
    ) returning * into v_row;

    return next v_row;
  end loop;

  return;
end;
$$;

revoke all on function public.create_recurring_appointments(uuid, timestamptz, timestamptz, uuid, uuid, int) from public;
grant execute on function public.create_recurring_appointments(uuid, timestamptz, timestamptz, uuid, uuid, int) to authenticated;

notify pgrst, 'reload schema';
