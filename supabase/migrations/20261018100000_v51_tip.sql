-- v51: bacsis optional la plata avansului (inregistrat pe programare si plata)
alter table public.appointments
  add column if not exists tip_ron numeric(10, 2) not null default 0;
