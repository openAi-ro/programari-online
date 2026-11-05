-- v109: optional public image on each service (one photo, stored in R2 business-media).
-- Client code stores the public Worker URL in services.image_url (same pattern as cover/gallery).
-- Not applied live without Rafael's OK.

alter table public.services
  add column if not exists image_url text;

comment on column public.services.image_url is
  'Public URL of the optional service photo (business-media via media Worker); null = no image.';
