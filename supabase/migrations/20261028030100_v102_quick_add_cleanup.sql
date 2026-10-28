-- v102 (3.03) — NU SE APLICĂ ÎNCĂ. Doar după ce 3.03 (business_create_appointment) e
-- publicat pe web + OTA și Rafael confirmă lista de mai jos.
-- 1) scoate business_create_walkin (folosit doar de 3.02 calendar walk-in);
-- 2) dezleagă de owner programările walk-in vechi (client_user_id = owner) și le pune pe fișă;
-- 3) backfill fișe pentru Frizerie (v35hit4q8j) și Ionut (zt0a7cr372), excluse din v101.
begin;

drop function if exists public.business_create_walkin(uuid, timestamptz, timestamptz, uuid, uuid, text, text);

-- Programări legate de owner (listă la 2026-10-28, toate Rafael/Frizerie, specialist Dragos):
--   23ce26b4-6510-4460-a3d7-e03cb0004326  2026-10-25 10:00  rejected   Tuns        tel+email
--   fc7b5bf4-9cfb-451b-93ce-5598d0c62bcd  2026-10-27 11:00  cancelled  Tuns        tel+email
--   ad2700a3-ddd0-4bdf-b8bb-51e99979f5f5  2026-10-28 17:30  approved   Manichiura  doar tel
-- ATENȚIE: primele două au și email → pot fi rezervări reale ale owner-ului ca client.
-- Rafael: șterge din listă id-urile care NU sunt walk-in înainte de aplicare.
with ids(id) as (values
  ('23ce26b4-6510-4460-a3d7-e03cb0004326'::uuid),
  ('fc7b5bf4-9cfb-451b-93ce-5598d0c62bcd'::uuid),
  ('ad2700a3-ddd0-4bdf-b8bb-51e99979f5f5'::uuid)
)
insert into public.business_clients (business_id, name, phone_e164, email, created_at)
select distinct on (a.business_id, coalesce(public.guest_phone_key(a.client_phone), lower(a.client_email)))
       a.business_id, nullif(btrim(a.guest_name), ''), public.normalize_phone_e164(a.client_phone),
       lower(nullif(btrim(a.client_email), '')), a.created_at
  from public.appointments a join ids on ids.id = a.id
 order by a.business_id, coalesce(public.guest_phone_key(a.client_phone), lower(a.client_email)), a.start_at desc
on conflict do nothing;

update public.appointments a
   set client_user_id = null,
       business_client_id = bc.id,
       notify_client = false
  from public.business_clients bc
 where a.id in ('23ce26b4-6510-4460-a3d7-e03cb0004326', 'fc7b5bf4-9cfb-451b-93ce-5598d0c62bcd',
                'ad2700a3-ddd0-4bdf-b8bb-51e99979f5f5')
   and a.client_user_id = (select owner_user_id from public.business_profiles where id = a.business_id)
   and bc.business_id = a.business_id and bc.user_id is null
   and ((bc.phone_key is not null and bc.phone_key = public.guest_phone_key(a.client_phone))
     or (public.guest_phone_key(a.client_phone) is null and lower(bc.email) = lower(a.client_email)));

-- 3) Guest-urile Frizerie / Ionut (client_user_id null) → fișe.
insert into public.business_clients (business_id, name, phone_e164, email, created_at)
select distinct on (a.business_id, coalesce(public.guest_phone_key(a.client_phone), lower(btrim(a.client_email))))
       a.business_id, left(nullif(btrim(a.guest_name), ''), 120), public.normalize_phone_e164(a.client_phone),
       lower(nullif(btrim(a.client_email), '')), a.created_at
  from public.appointments a join public.business_profiles b on b.id = a.business_id
 where a.client_user_id is null and b.public_code in ('v35hit4q8j', 'zt0a7cr372')
   and (public.normalize_phone_e164(a.client_phone) is not null or nullif(btrim(a.client_email), '') is not null)
 order by a.business_id, coalesce(public.guest_phone_key(a.client_phone), lower(btrim(a.client_email))), a.start_at desc
on conflict do nothing;

update public.appointments a
   set business_client_id = bc.id
  from public.business_clients bc, public.business_profiles b
 where b.id = a.business_id and b.public_code in ('v35hit4q8j', 'zt0a7cr372')
   and a.client_user_id is null and a.business_client_id is null
   and bc.business_id = a.business_id and bc.user_id is null
   and ((bc.phone_key is not null and bc.phone_key = public.guest_phone_key(a.client_phone))
     or (public.guest_phone_key(a.client_phone) is null and bc.phone_key is null
         and lower(bc.email) = lower(btrim(a.client_email))));

commit;
