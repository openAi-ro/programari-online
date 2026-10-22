-- perf_fk_indexes_and_rls_initplan: aplicata direct pe live (21.10.2026) din alta sesiune, fara fisier local.
-- Fisier recreat 1:1 din supabase_migrations.schema_migrations ca istoricul local sa fie sincron.

create index if not exists appointments_service_id_fk_idx on public.appointments (service_id);
create index if not exists chat_conversations_client_user_id_fk_idx on public.chat_conversations (client_user_id);
create index if not exists chat_messages_sender_user_id_fk_idx on public.chat_messages (sender_user_id);
create index if not exists client_blocks_client_user_id_fk_idx on public.client_blocks (client_user_id);
create index if not exists client_intake_client_user_id_fk_idx on public.client_intake (client_user_id);
create index if not exists client_notes_client_user_id_fk_idx on public.client_notes (client_user_id);
create index if not exists client_packages_business_id_fk_idx on public.client_packages (business_id);
create index if not exists client_packages_package_id_fk_idx on public.client_packages (package_id);
create index if not exists client_photos_client_user_id_fk_idx on public.client_photos (client_user_id);
create index if not exists payments_business_id_fk_idx on public.payments (business_id);
create index if not exists payments_client_user_id_fk_idx on public.payments (client_user_id);
create index if not exists reviews_client_user_id_fk_idx on public.reviews (client_user_id);
create index if not exists reviews_staff_id_fk_idx on public.reviews (staff_id);
create index if not exists waitlist_client_user_id_fk_idx on public.waitlist (client_user_id);
create index if not exists waitlist_service_id_fk_idx on public.waitlist (service_id);
create index if not exists waitlist_staff_id_fk_idx on public.waitlist (staff_id);
alter policy "appointments_select_participant" on public.appointments using ((((select auth.uid()) = client_user_id) OR ((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = appointments.business_id))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (((p.email IS NOT NULL) AND (p.email <> ''::text) AND (p.email = appointments.client_email)) OR ((p.phone IS NOT NULL) AND (p.phone <> ''::text) AND (p.phone = appointments.client_phone))))))));
alter policy "appointments_update_owner" on public.appointments using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = appointments.business_id))));
alter policy "business_insert_owner" on public.business_profiles with check (((select auth.uid()) = owner_user_id));
alter policy "business_update_owner" on public.business_profiles using (((select auth.uid()) = owner_user_id));
alter policy "chat_conversations_select_participant" on public.chat_conversations using ((((select auth.uid()) = client_user_id) OR (business_id IN ( SELECT b.id
   FROM business_profiles b
  WHERE (b.owner_user_id = (select auth.uid()))))));
alter policy "chat_messages_insert_participant" on public.chat_messages with check (((EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND ((c.client_user_id = (select auth.uid())) OR (c.business_id IN ( SELECT b.id
           FROM business_profiles b
          WHERE (b.owner_user_id = (select auth.uid())))))))) AND (sender_user_id = (select auth.uid()))));
alter policy "chat_messages_select_participant" on public.chat_messages using ((EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id = chat_messages.conversation_id) AND ((c.client_user_id = (select auth.uid())) OR (c.business_id IN ( SELECT b.id
           FROM business_profiles b
          WHERE (b.owner_user_id = (select auth.uid())))))))));
alter policy "client_blocks_owner" on public.client_blocks using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_blocks.business_id)))) with check (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_blocks.business_id))));
alter policy "client_favorites_delete_own" on public.client_favorites using (((select auth.uid()) = user_id));
alter policy "client_favorites_insert_own" on public.client_favorites with check (((select auth.uid()) = user_id));
alter policy "client_favorites_select_own" on public.client_favorites using (((select auth.uid()) = user_id));
alter policy "intake_client_rw" on public.client_intake using ((client_user_id = (select auth.uid()))) with check ((client_user_id = (select auth.uid())));
alter policy "intake_owner_select" on public.client_intake using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_intake.business_id))));
alter policy "client_notes_owner" on public.client_notes using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_notes.business_id)))) with check (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_notes.business_id))));
alter policy "client_packages_client_select" on public.client_packages using ((client_user_id = (select auth.uid())));
alter policy "client_packages_owner_all" on public.client_packages using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_packages.business_id)))) with check (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_packages.business_id))));
alter policy "photos_client_select" on public.client_photos using ((client_user_id = (select auth.uid())));
alter policy "photos_owner_delete" on public.client_photos using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_photos.business_id))));
alter policy "photos_owner_insert" on public.client_photos with check ((((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_photos.business_id))) AND (EXISTS ( SELECT 1
   FROM client_intake i
  WHERE ((i.business_id = client_photos.business_id) AND (i.client_user_id = client_photos.client_user_id) AND i.photo_consent)))));
alter policy "photos_owner_select" on public.client_photos using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = client_photos.business_id))));
alter policy "push_tokens_own" on public.device_push_tokens using (((select auth.uid()) = user_id)) with check (((select auth.uid()) = user_id));
alter policy "gift_cards_owner_all" on public.gift_cards using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = gift_cards.business_id)))) with check (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = gift_cards.business_id))));
alter policy "packages_client_select" on public.packages using (((select auth.uid()) IN ( SELECT cp.client_user_id
   FROM client_packages cp
  WHERE (cp.package_id = packages.id))));
alter policy "packages_owner_all" on public.packages using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = packages.business_id)))) with check (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = packages.business_id))));
alter policy "payments_select" on public.payments using ((((select auth.uid()) = client_user_id) OR ((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = payments.business_id)))));
alter policy "profiles_insert_own" on public.profiles with check (((select auth.uid()) = id));
alter policy "profiles_select_own" on public.profiles using (((select auth.uid()) = id));
alter policy "profiles_update_own" on public.profiles using (((select auth.uid()) = id));
alter policy "referrals_owner_select" on public.referrals using (((referrer_user_id = (select auth.uid())) OR (referred_user_id = (select auth.uid()))));
alter policy "reviews_select" on public.reviews using ((((select auth.uid()) = client_user_id) OR ((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = reviews.business_id)))));
alter policy "services_select_authenticated" on public.services using (((active = true) OR ((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = services.business_id)))));
alter policy "services_write_owner" on public.services using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = services.business_id)))) with check (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = services.business_id))));
alter policy "staff_select_authenticated" on public.staff using (((active = true) OR ((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = staff.business_id)))));
alter policy "staff_write_owner" on public.staff using (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = staff.business_id)))) with check (((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = staff.business_id))));
alter policy "waitlist_select_own" on public.waitlist using ((((select auth.uid()) = client_user_id) OR ((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = waitlist.business_id)))));
alter policy "waitlist_update_owner" on public.waitlist using ((((select auth.uid()) = client_user_id) OR ((select auth.uid()) IN ( SELECT b.owner_user_id
   FROM business_profiles b
  WHERE (b.id = waitlist.business_id)))));
