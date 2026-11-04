-- v103 — profiles.email devine read-only pentru client (anon/authenticated).
-- NU SE APLICĂ ÎNCĂ. Blocaj: 3.10 (web + OTA) trimite încă `email` în UPDATE-ul din
-- Setări (handleSave: ...(email ? { email } : {})) și în upsert-ul pentru avatar; după
-- acest revoke, salvarea profilului ar da „permission denied” pentru toți utilizatorii.
-- Se aplică doar după ce 3.11 (fără email în update/upsert, inclusiv home.tsx,
-- lib/accountKind.ts și lib/bookingRpc.ts) e publicat pe web + OTA.
--
-- anon și authenticated au UPDATE la nivel de tabel pe public.profiles, așa că
-- `revoke update (email)` singur nu ar avea efect: revocăm UPDATE pe tabel și dăm
-- înapoi lui authenticated UPDATE pe toate coloanele, în afară de email.
-- profiles.email rămâne sincronizat din auth.users de triggerele SECURITY DEFINER
-- (owner postgres): on_auth_user_created -> handle_new_user și
-- on_auth_user_email_changed -> sync_profile_email_from_auth.
-- INSERT rămâne neschimbat (rândul e creat oricum de handle_new_user).
begin;

revoke update on public.profiles from anon, authenticated;

grant update (
  id,
  account_kind,
  avatar_url,
  country,
  created_at,
  display_name,
  language,
  notify_decision,
  notify_reminders,
  notify_whatsapp,
  phone,
  referral_code
) on public.profiles to authenticated;

commit;
