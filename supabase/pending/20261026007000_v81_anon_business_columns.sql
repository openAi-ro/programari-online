-- v81 (11a): anon vede doar coloanele publice din business_profiles (cele afișate pe /b/<cod>,
-- în browse, meta SSR și sitemap). Ascunse: owner_user_id, auto_approve_returning,
-- no_show_block_after, created_at, updated_at. authenticated rămâne neschimbat.
-- Lista trebuie să rămână identică cu ANON_BUSINESS_COLUMNS (apps/mobile/lib/publicPageMeta.ts).
-- PRECONDIȚIE: clientul publicat nu mai face select('*') ca anon pe business_profiles (>= 2.96).

-- Politicile de mai jos citesc business_profiles.owner_user_id; pentru anon (auth.uid() null) nu
-- pot fi niciodată adevărate, dar ar da "permission denied" după restrângerea coloanelor.
-- Le limităm la authenticated: comportament identic, fără eroare pentru anon.
alter policy appointments_select_participant on public.appointments to authenticated;
alter policy appointments_update_owner on public.appointments to authenticated;
alter policy chat_conversations_select_participant on public.chat_conversations to authenticated;
alter policy chat_messages_insert_participant on public.chat_messages to authenticated;
alter policy chat_messages_select_participant on public.chat_messages to authenticated;

revoke all on table public.business_profiles from anon;
grant select (id, name, public_code, timezone, session_duration_minutes, working_hours, break_hours, min_notice_minutes, buffer_minutes, max_advance_days, cancel_notice_minutes, blocked_dates, deposit_ron, loyalty_every, address, city, maps_url, latitude, longitude, county, logo_url, promo_video_url, category, country, google_review_url, instagram_url, facebook_url, offpeak_discount_percent, offpeak_start_hour, offpeak_end_hour, referral_enabled, referral_reward_text, description, cover_url, gallery_urls, website_enabled, contact_phone) on table public.business_profiles to anon;
