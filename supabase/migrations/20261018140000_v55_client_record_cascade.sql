-- v55: fisa clientului si pozele inainte/dupa se sterg odata cu contul clientului.
-- Inainte: client_user_id fara cheie straina -> randurile ramaneau dupa
-- stergerea contului. Acum: FK spre profiles(id) ON DELETE CASCADE
-- (la fel ca client_notes; profiles se sterge in cascada din auth.users).
-- Fisierele din bucket-ul privat 'client-photos' le sterge functia delete-account.

alter table public.client_intake
  drop constraint if exists client_intake_client_user_id_fkey,
  add constraint client_intake_client_user_id_fkey
    foreign key (client_user_id) references public.profiles(id) on delete cascade;

alter table public.client_photos
  drop constraint if exists client_photos_client_user_id_fkey,
  add constraint client_photos_client_user_id_fkey
    foreign key (client_user_id) references public.profiles(id) on delete cascade;
