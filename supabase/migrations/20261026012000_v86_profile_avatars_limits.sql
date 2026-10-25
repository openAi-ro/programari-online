-- Pas 11i: profile-avatars accepta doar imagini jpeg/png/webp de maxim 5 MB (ca business-logos /
-- staff-photos). Fisierele existente (10: png/jpeg, max ~234 KB) respecta deja limita.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'profile-avatars';
