-- Seed 14 TEST businesses (one per browse category). Marked TEST for easy cleanup.
-- Owner: existing test business user (Salon Test Locație).
-- Idempotent: upserts by public_code prefix testcat_

with cats(key, label, lat, lng) as (
  values
    ('coafura',      'Test Coafură',              44.4268, 26.1025),
    ('frizerie',     'Test Frizerie',             44.4275, 26.1035),
    ('cosmetica',    'Test Cosmetică',            44.4282, 26.1045),
    ('makeup',       'Test Makeup',               44.4289, 26.1055),
    ('epilare',      'Test Epilare Definitivă',   44.4296, 26.1065),
    ('sprancene',    'Test Îngrijire Sprâncene',  44.4303, 26.1075),
    ('unghii',       'Test Unghii cu Gel',        44.4310, 26.1085),
    ('medical',      'Test Cabinete Medicale',    44.4317, 26.1095),
    ('stomatologie', 'Test Cabinete Stomatologice', 44.4324, 26.1105),
    ('masaj',        'Test Masaj / Spa',          44.4331, 26.1115),
    ('fitness',      'Test Fitness',              44.4338, 26.1125),
    ('psihologie',   'Test Psihologie / Terapie', 44.4345, 26.1135),
    ('veterinar',    'Test Veterinar',            44.4352, 26.1145),
    ('auto',         'Test Auto Service',         44.4359, 26.1155)
),
wh as (
  select '{
    "mon":{"closed":false,"start":"09:00","end":"18:00"},
    "tue":{"closed":false,"start":"09:00","end":"18:00"},
    "wed":{"closed":false,"start":"09:00","end":"18:00"},
    "thu":{"closed":false,"start":"09:00","end":"18:00"},
    "fri":{"closed":false,"start":"09:00","end":"18:00"},
    "sat":{"closed":false,"start":"10:00","end":"14:00"},
    "sun":{"closed":true}
  }'::jsonb as working_hours
),
owner as (
  select 'fe876584-f582-4e9f-a427-1048e72fc9bd'::uuid as owner_user_id
)
insert into public.business_profiles (
  owner_user_id, name, public_code, category, city, county, address,
  latitude, longitude, timezone, session_duration_minutes, working_hours
)
select
  o.owner_user_id,
  c.label,
  'testcat_' || c.key,
  c.key,
  'București',
  'București',
  'Str. TEST ' || c.label || ' 1',
  c.lat,
  c.lng,
  'Europe/Bucharest',
  60,
  w.working_hours
from cats c
cross join wh w
cross join owner o
on conflict (public_code) do update set
  name = excluded.name,
  category = excluded.category,
  city = excluded.city,
  county = excluded.county,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  updated_at = now()
returning name, public_code, category, city;
