-- v110: cadouri cu o singura folosire (suma SAU serviciu), expirare 12 luni, RPC create/redeem/cancel, lookup cu expirare.
-- Cardurile existente pastreaza expires_at NULL (= nu expira). UPDATE direct pe gift_cards ramane pentru app-ul vechi 3.19.

-- Coloane noi (fara recrearea tabelului)
alter table public.gift_cards
  add column if not exists kind text not null default 'amount',
  add column if not exists service_id uuid references public.services(id) on delete restrict,
  add column if not exists expires_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists redeemed_by uuid,
  add column if not exists redeemed_at timestamptz,
  add column if not exists redeemed_appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_at timestamptz;

-- Tip: suma SAU serviciu (nu ambele). amount ramane pentru compatibilitate (pretul serviciului la emitere).
alter table public.gift_cards drop constraint if exists gift_cards_amount_check;
alter table public.gift_cards drop constraint if exists gift_cards_kind_check;
alter table public.gift_cards
  add constraint gift_cards_kind_check check (kind in ('amount', 'service'));
alter table public.gift_cards
  add constraint gift_cards_amount_check check (
    (kind = 'amount' and amount > 0 and service_id is null)
    or (kind = 'service' and service_id is not null and amount >= 0)
  );

-- Cod unic global (inainte era unic doar pe business)
alter table public.gift_cards drop constraint if exists gift_cards_business_id_code_key;
create unique index if not exists gift_cards_code_uidx on public.gift_cards (code);
create index if not exists gift_cards_service_idx on public.gift_cards (service_id) where service_id is not null;

comment on column public.gift_cards.kind is 'amount = suma fixa in lei; service = un serviciu anume (o folosire).';
comment on column public.gift_cards.expires_at is 'NULL = nu expira (carduri vechi). Cardurile noi: now() + 12 luni la creare.';
comment on column public.gift_cards.balance is 'Compatibilitate app vechi; la folosire se pune 0. Modelul nou e o singura folosire.';

-- Generator de cod in DB (fara 0/O/1/I), 16 caractere, forma stocata fara cratime.
create or replace function public.generate_gift_card_code()
returns text
language plpgsql
volatile
set search_path = public
as $fn$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw text;
  i int;
  attempt int := 0;
begin
  loop
    raw := '';
    for i in 1..16 loop
      raw := raw || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.gift_cards g where g.code = raw);
    attempt := attempt + 1;
    if attempt > 32 then
      raise exception 'gift_code_generation_failed';
    end if;
  end loop;
  return raw;
end;
$fn$;

revoke all on function public.generate_gift_card_code() from public;
grant execute on function public.generate_gift_card_code() to authenticated, service_role;

-- Creare cadou (owner/admin). Expirare implicita 12 luni.
create or replace function public.create_gift_card(
  p_business_id uuid,
  p_kind text,
  p_amount numeric default null,
  p_service_id uuid default null,
  p_recipient_name text default null
) returns public.gift_cards
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text := public.business_member_role(p_business_id);
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_amount numeric(10,2);
  v_service_id uuid;
  v_code text;
  v_row public.gift_cards;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_role is distinct from 'owner' and v_role is distinct from 'admin' then
    raise exception 'not_allowed';
  end if;
  if v_kind not in ('amount', 'service') then
    raise exception 'gift_kind_invalid';
  end if;

  if v_kind = 'amount' then
    if p_amount is null or p_amount <= 0 then raise exception 'gift_amount_invalid'; end if;
    if p_service_id is not null then raise exception 'gift_kind_invalid'; end if;
    v_amount := round(p_amount::numeric, 2);
    v_service_id := null;
  else
    if p_service_id is null then raise exception 'gift_service_required'; end if;
    select s.price into v_amount
      from public.services s
     where s.id = p_service_id and s.business_id = p_business_id and s.active = true;
    if not found then raise exception 'gift_service_not_found'; end if;
    v_service_id := p_service_id;
    v_amount := round(coalesce(v_amount, 0)::numeric, 2);
  end if;

  v_code := public.generate_gift_card_code();

  insert into public.gift_cards (
    business_id, code, amount, balance, recipient_name, status,
    kind, service_id, expires_at, created_by
  ) values (
    p_business_id,
    v_code,
    v_amount,
    v_amount,
    nullif(trim(coalesce(p_recipient_name, '')), ''),
    'active',
    v_kind,
    v_service_id,
    now() + interval '12 months',
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.create_gift_card(uuid, text, numeric, uuid, text) from public;
grant execute on function public.create_gift_card(uuid, text, numeric, uuid, text) to authenticated, service_role;

-- Folosire: doar daca e active + neexpirat. Atomic.
create or replace function public.redeem_gift_card(
  p_gift_card_id uuid,
  p_appointment_id uuid default null
) returns public.gift_cards
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.gift_cards;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_row from public.gift_cards where id = p_gift_card_id for update;
  if not found then raise exception 'gift_not_found'; end if;

  v_role := public.business_member_role(v_row.business_id);
  if v_role is distinct from 'owner' and v_role is distinct from 'admin' then
    raise exception 'not_allowed';
  end if;

  if v_row.status is distinct from 'active' then raise exception 'gift_not_unused'; end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'gift_expired';
  end if;

  if p_appointment_id is not null then
    if not exists (
      select 1 from public.appointments a
       where a.id = p_appointment_id and a.business_id = v_row.business_id
    ) then
      raise exception 'gift_appointment_invalid';
    end if;
  end if;

  update public.gift_cards
     set balance = 0,
         status = 'redeemed',
         redeemed_by = auth.uid(),
         redeemed_at = now(),
         redeemed_appointment_id = p_appointment_id,
         updated_at = now()
   where id = p_gift_card_id
     and status = 'active'
     and (expires_at is null or expires_at > now())
  returning * into v_row;

  if not found then raise exception 'gift_not_unused'; end if;
  return v_row;
end;
$fn$;

revoke all on function public.redeem_gift_card(uuid, uuid) from public;
grant execute on function public.redeem_gift_card(uuid, uuid) to authenticated, service_role;

-- Anulare: doar daca e inca nefolosit (expirat se poate anula).
create or replace function public.cancel_gift_card(p_gift_card_id uuid)
returns public.gift_cards
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.gift_cards;
  v_role text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_row from public.gift_cards where id = p_gift_card_id for update;
  if not found then raise exception 'gift_not_found'; end if;

  v_role := public.business_member_role(v_row.business_id);
  if v_role is distinct from 'owner' and v_role is distinct from 'admin' then
    raise exception 'not_allowed';
  end if;

  if v_row.status is distinct from 'active' then raise exception 'gift_not_unused'; end if;

  update public.gift_cards
     set status = 'cancelled',
         cancelled_by = auth.uid(),
         cancelled_at = now(),
         updated_at = now()
   where id = p_gift_card_id
     and status = 'active'
  returning * into v_row;

  if not found then raise exception 'gift_not_unused'; end if;
  return v_row;
end;
$fn$;

revoke all on function public.cancel_gift_card(uuid) from public;
grant execute on function public.cancel_gift_card(uuid) to authenticated, service_role;

-- Lookup client logat: fara lista completa; include expirarea.
drop function if exists public.check_gift_card(text);
create function public.check_gift_card(p_code text)
returns table (
  business_name text,
  balance numeric(10, 2),
  status text,
  amount numeric(10, 2),
  kind text,
  service_name text,
  expires_at timestamptz,
  expired boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  return query
  select
    b.name,
    g.balance,
    g.status,
    g.amount,
    g.kind,
    s.name,
    g.expires_at,
    (g.expires_at is not null and g.expires_at <= now()) as expired
  from public.gift_cards g
  join public.business_profiles b on b.id = g.business_id
  left join public.services s on s.id = g.service_id
  where g.code = upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'))
  limit 1;
end;
$fn$;

revoke all on function public.check_gift_card(text) from public;
grant execute on function public.check_gift_card(text) to authenticated, service_role;

-- RLS: owner + admin (ca in restul app-ului). UPDATE direct ramane pentru 3.19.
drop policy if exists gift_cards_owner_all on public.gift_cards;
drop policy if exists gift_cards_member_all on public.gift_cards;
create policy gift_cards_member_all on public.gift_cards
  for all to authenticated
  using (public.business_member_role(business_id) in ('owner', 'admin'))
  with check (public.business_member_role(business_id) in ('owner', 'admin'));

-- Fara drepturi anon pe datele de cadou
revoke all on table public.gift_cards from anon;
grant select, insert, update, delete on table public.gift_cards to authenticated;
grant all on table public.gift_cards to service_role;

notify pgrst, 'reload schema';
