-- v64: corecteaza comentariul coloanei website_enabled (v60 il descria gresit).
-- Decizia de produs: false ascunde doar vitrina (prezentarea); pagina /b ramane
-- functionala cu formularul minim de programare. Nu exista mesaj de indisponibil.
comment on column public.business_profiles.website_enabled is
  'false = vitrina (prezentarea publica) ascunsa; pagina /b ramane functionala, doar cu formularul de programare.';
