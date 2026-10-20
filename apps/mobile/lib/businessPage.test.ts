import {
  addGalleryUrl,
  buildAutoDescription,
  effectiveDescription,
  MAX_GALLERY_PHOTOS,
  normalizeGalleryUrls,
  removeGalleryUrl,
  presentationEnabled,
  telUrl,
  visibleCoverUrl,
  whatsAppUrl,
} from './businessPage';

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}

function main() {
  // Galerie: normalizare, limită, duplicate
  assert(normalizeGalleryUrls(null).length === 0, 'galerie null');
  assert(normalizeGalleryUrls([' a ', '', 'a', 'b']).join(',') === 'a,b', 'dedupe+trim');
  const many = Array.from({ length: 20 }, (_, i) => `u${i}`);
  assert(normalizeGalleryUrls(many).length === MAX_GALLERY_PHOTOS, 'limita 12 la normalizare');
  assert(addGalleryUrl(['a'], 'b').join(',') === 'a,b', 'adauga');
  assert(addGalleryUrl(['a'], 'a').length === 1, 'nu adauga duplicat');
  const full = Array.from({ length: MAX_GALLERY_PHOTOS }, (_, i) => `u${i}`);
  assert(addGalleryUrl(full, 'nou').length === MAX_GALLERY_PHOTOS, 'nu trece de limita');
  assert(removeGalleryUrl(['a', 'b'], 'a').join(',') === 'b', 'sterge');

  // Descriere: a firmei are prioritate
  const own = effectiveDescription({
    description: '  Text propriu. ',
    name: 'Salon Ana',
    serviceNames: [],
  });
  assert(own === 'Text propriu.', 'descrierea proprie e pastrata (trim)');

  // Sablon complet: nume + categorie + oras + servicii + CTA
  const fullText = buildAutoDescription({
    name: 'Salon Ana',
    categoryLabel: 'Coafură',
    city: 'Cluj-Napoca',
    county: 'Cluj',
    serviceNames: ['Tuns', 'Vopsit', 'Coafat', 'Manichiura', 'Tratament', 'Extra'],
  });
  assert(fullText.includes('Salon Ana'), 'sablon: nume');
  assert(fullText.includes('coafură în Cluj-Napoca'), 'sablon: categorie + oras in prima propozitie');
  assert(!fullText.includes('Ne găsești'), 'sablon: orasul nu se repeta');
  const noCatText = buildAutoDescription({
    name: 'Salon Ana',
    city: 'Cluj-Napoca',
    county: 'Cluj',
    serviceNames: [],
  });
  assert(noCatText.includes('Ne găsești în Cluj-Napoca, Cluj'), 'sablon fara categorie: loc separat');
  assert(fullText.includes('Tuns'), 'sablon: primul serviciu');
  assert(fullText.includes('Tratament'), 'sablon: al 5-lea serviciu');
  assert(!fullText.includes('Extra,'), 'sablon: al 6-lea nu e listat nominal');
  assert(fullText.includes('și altele') || fullText.includes('and more'), 'sablon: sufix mai multe');

  // Sablon sarac: doar nume -> fara propozitii goale
  const poor = buildAutoDescription({ name: 'X', serviceNames: [] });
  assert(!poor.includes('..'), 'sablon sarac: fara puncte duble');
  assert(!poor.includes('Oferim') && !poor.includes('We offer'), 'sablon sarac: fara servicii');
  assert(poor.length > 0, 'sablon sarac: totusi are bun-venit + CTA');

  // Telefon public -> tel: / wa.me
  assert(telUrl('0722 111 222') === 'tel:+40722111222', 'tel url din numar national');
  assert(whatsAppUrl('0722111222') === 'https://wa.me/40722111222', 'wa.me din numar national');
  assert(whatsAppUrl('+40 722 111 222') === 'https://wa.me/40722111222', 'wa.me din E.164');
  assert(telUrl('') === null && telUrl(null) === null && telUrl('abc') === null, 'telefon invalid -> null');

  // website_enabled: doar prezentarea se ascunde, programarea ramane
  assert(presentationEnabled(true) === true, 'website_enabled true -> prezentare vizibila');
  assert(presentationEnabled(false) === false, 'website_enabled false -> prezentare ascunsa');
  assert(presentationEnabled(null) === true, 'website_enabled null (rand vechi) -> vizibila');
  assert(presentationEnabled(undefined) === true, 'website_enabled lipsa -> vizibila');
  assert(
    visibleCoverUrl({ cover_url: 'https://x/c.jpg', website_enabled: true }) === 'https://x/c.jpg',
    'coperta vizibila cand prezentarea e activa'
  );
  assert(
    visibleCoverUrl({ cover_url: 'https://x/c.jpg', website_enabled: false }) === null,
    'coperta ascunsa in carusel cand prezentarea e oprita'
  );
  assert(
    visibleCoverUrl({ cover_url: null, website_enabled: true }) === null,
    'fara coperta -> null'
  );

  console.log('businessPage.test: OK');
}

main();
