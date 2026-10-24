// Aserțiuni minime (proiectul nu are @types/node; testele rulează cu `npx tsx`).
function fail(msg: string): never {
  throw new Error(msg);
}
const assert = {
  equal(a: unknown, b: unknown) {
    if (a !== b) fail(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  deepEqual(a: unknown, b: unknown) {
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  ok(v: unknown) {
    if (!v) fail('expected truthy');
  },
  match(s: string, re: RegExp) {
    if (!re.test(s)) fail(`${JSON.stringify(s)} does not match ${re}`);
  },
};

import {
  GENERIC_TITLE,
  buildOpeningHours,
  buildPublicPageMeta,
  buildSitemapXml,
  jsonLdText,
  schemaTypeFor,
  toExpoMetadata,
  truncate,
  type PublicBusiness,
} from './publicPageMeta';

const hours = {
  mon: { closed: false, start: '09:00', end: '18:00' },
  tue: { closed: false, start: '09:00', end: '18:00' },
  wed: { closed: false, start: '09:00', end: '18:00' },
  thu: { closed: false, start: '09:00', end: '18:00' },
  fri: { closed: false, start: '09:00', end: '20:00' },
  sat: { closed: false, start: '10:00', end: '14:00' },
  sun: { closed: true },
} as const;

const biz: PublicBusiness = {
  id: 'b1',
  name: 'Frizerie Test',
  public_code: 'ABC123',
  description: null,
  cover_url: 'https://cdn.example.com/cover.jpg',
  logo_url: 'https://cdn.example.com/logo.png',
  address: 'Str. Lungă 1',
  city: 'Cluj-Napoca',
  county: 'Cluj',
  latitude: 46.77,
  longitude: 23.6,
  working_hours: hours as never,
  contact_phone: '+40712345678',
  category: 'frizerie',
  website_enabled: true,
  instagram_url: 'https://instagram.com/x',
  facebook_url: 'not a url',
};

// Salon activ: titlu, canonical, imagine, JSON-LD complet.
{
  const m = buildPublicPageMeta({
    business: biz,
    rating: { avg_rating: '4.86', review_count: 7 },
    origin: 'https://programari.expo.app/',
  });
  assert.equal(m.title, 'Frizerie Test – Cluj-Napoca | Programare online');
  assert.equal(m.canonical, 'https://programari.expo.app/b/abc123');
  assert.equal(m.url, m.canonical);
  assert.equal(m.image, 'https://cdn.example.com/cover.jpg');
  assert.equal(m.indexable, true);
  assert.match(m.description, /^Programează-te online la Frizerie Test, Cluj-Napoca\./);
  const ld = m.jsonLd as Record<string, any>;
  assert.equal(ld['@type'], 'HairSalon');
  assert.equal(ld.url, m.canonical);
  assert.deepEqual(ld.geo, { '@type': 'GeoCoordinates', latitude: 46.77, longitude: 23.6 });
  assert.equal(ld.address.addressLocality, 'Cluj-Napoca');
  assert.equal(ld.address.addressCountry, 'RO');
  assert.deepEqual(ld.aggregateRating, {
    '@type': 'AggregateRating',
    ratingValue: 4.9,
    reviewCount: 7,
    bestRating: 5,
    worstRating: 1,
  });
  assert.deepEqual(ld.sameAs, ['https://instagram.com/x']);
  assert.equal(ld.openingHoursSpecification.length, 3);
  assert.deepEqual(ld.openingHoursSpecification[0].dayOfWeek, ['Monday', 'Tuesday', 'Wednesday', 'Thursday']);

  const md = toExpoMetadata(m);
  assert.equal(md.openGraph.url, m.canonical);
  assert.deepEqual(md.openGraph.images, [{ url: m.image, alt: m.title }]);
  assert.equal(md.twitter.card, 'summary_large_image');
  assert.equal(md.alternates.canonical, m.canonical);
  assert.deepEqual(md.robots, { index: true, follow: true });
}

// Fără recenzii -> fără aggregateRating; fără copertă -> logo.
{
  const m = buildPublicPageMeta({
    business: { ...biz, cover_url: null },
    rating: { avg_rating: null, review_count: 0 },
  });
  assert.equal((m.jsonLd as Record<string, unknown>).aggregateRating, undefined);
  assert.equal(m.image, 'https://cdn.example.com/logo.png');
  assert.ok(m.canonical.startsWith('https://programari.expo.app/b/'));
}

// Lipsă / pagină oprită -> generic + noindex, fără date despre salon.
for (const business of [null, { ...biz, website_enabled: false }]) {
  const m = buildPublicPageMeta({ business, code: 'zzz', origin: 'https://programari.expo.app' });
  assert.equal(m.title, GENERIC_TITLE);
  assert.equal(m.indexable, false);
  assert.equal(m.jsonLd, null);
  assert.equal(m.image, null);
  assert.ok(!m.description.includes('Frizerie Test'));
  assert.equal(toExpoMetadata(m).twitter.card, 'summary');
}

// website_enabled null = activ (ca presentationEnabled).
assert.equal(buildPublicPageMeta({ business: { ...biz, website_enabled: null } }).indexable, true);

// Utilitare.
assert.equal(schemaTypeFor('coafura'), 'HairSalon');
assert.equal(schemaTypeFor('cosmetica'), 'BeautySalon');
assert.equal(schemaTypeFor(null), 'LocalBusiness');
assert.deepEqual(buildOpeningHours(null), []);
assert.deepEqual(
  buildOpeningHours({ ...hours, mon: { closed: false, start: '9', end: 'x' } } as never).length,
  3
);
const long = 'cuvânt '.repeat(60).trim();
assert.ok(truncate(long).length <= 160);
assert.ok(truncate(long).endsWith('…'));
assert.equal(jsonLdText({ a: '</script><b>' }), '{"a":"\\u003c/script>\\u003cb>"}');
assert.equal(jsonLdText(null), null);

const xml = buildSitemapXml('https://programari.expo.app', [
  { public_code: 'AbC' },
  { public_code: 'abc' },
  { public_code: null },
  { public_code: 'x&y' },
]);
assert.ok(xml.startsWith('<?xml'));
assert.equal((xml.match(/<url>/g) ?? []).length, 3);
assert.ok(xml.includes('<loc>https://programari.expo.app/b/abc</loc>'));
assert.ok(xml.includes('x%26y'));

console.log('publicPageMeta.test: ok');
