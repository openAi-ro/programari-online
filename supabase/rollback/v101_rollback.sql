-- Rollback pentru v101_business_quick_add (3.03). Readuce schema la starea v100.
-- Programările create între timp cu business_create_appointment rămân (doar își pierd
-- coloanele v101). Rulare: SQL editor / MCP execute_sql, o singură tranzacție.
begin;
drop function if exists public.list_business_contact_clients();
drop function if exists public.search_business_client_contacts(uuid, text);
drop function if exists public.business_create_appointment(uuid, timestamptz, uuid[], uuid, uuid, uuid, text, text, text, text, boolean);
alter table public.appointments
  drop column if exists business_note,
  drop column if exists notify_client,
  drop column if exists created_by,
  drop column if exists business_client_id;
drop table if exists public.business_clients;
drop function if exists public.normalize_phone_e164(text);
commit;
