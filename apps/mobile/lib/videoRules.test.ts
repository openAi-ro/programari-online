/**
 * Run: npx tsx lib/videoRules.test.ts
 * from apps/mobile
 */
import {
  PROMO_VIDEO_BUCKET,
  pickerDurationToMs,
  resolveVideoExtension,
  validatePromoVideoAsset,
  videoContentType,
  videoExtensionFromMimeType,
  videoExtensionFromUri,
} from './videoRules';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

assert(PROMO_VIDEO_BUCKET === 'business-videos', 'bucket video');
assert(
  validatePromoVideoAsset({ sizeBytes: 1024, durationMs: 30000, extension: 'mp4' }) === null,
  'mp4 scurt acceptat'
);
assert(
  validatePromoVideoAsset({ sizeBytes: 1024, durationMs: 30000, extension: 'MOV' }) === null,
  'extensie case-insensitive'
);
assert(
  validatePromoVideoAsset({ sizeBytes: 60 * 1024 * 1024, durationMs: 30000, extension: 'mp4' }) !== null,
  'fisier >50MB respins'
);
assert(
  validatePromoVideoAsset({ sizeBytes: 1024, durationMs: 120000, extension: 'mp4' }) !== null,
  'video >90s respins'
);
assert(
  validatePromoVideoAsset({ sizeBytes: 1024, durationMs: 30000, extension: 'avi' }) !== null,
  'avi respins'
);
assert(
  validatePromoVideoAsset({ sizeBytes: null, durationMs: null, extension: 'mp4' }) === null,
  'lipsa metadate nu blocheaza'
);
assert(videoExtensionFromUri('file:///x/clip.MP4?x=1') === 'mp4', 'extensie din uri');
assert(videoExtensionFromUri('file:///x/clip') !== 'mp4', 'fara extensie nu trece ca mp4');

// Regresie: pickerul nativ raporteaza milisecunde — un video de 10s (10000ms)
// nu trebuie respins ca "prea lung".
assert(
  validatePromoVideoAsset({ sizeBytes: 5 * 1024 * 1024, durationMs: 10000, extension: 'mp4' }) === null,
  'video 10s (10000ms) acceptat'
);
assert(pickerDurationToMs(10000, 'android') === 10000, 'android: ms raman ms');
assert(pickerDurationToMs(10000.4, 'ios') === 10000, 'ios: ms rotunjite');
assert(pickerDurationToMs(10, 'web') === 10000, 'web: secunde convertite la ms');
assert(pickerDurationToMs(null, 'android') === null, 'durata lipsa -> null');
assert(pickerDurationToMs(-5, 'android') === null, 'durata negativa -> null');

// Filmare: MIME-ul decide, chiar daca URI-ul e content:// fara extensie.
assert(videoExtensionFromMimeType('video/mp4') === 'mp4', 'mime mp4 -> mp4');
assert(videoExtensionFromMimeType('video/quicktime') === 'mov', 'mime quicktime -> mov');
assert(videoExtensionFromMimeType('video/x-m4v') === 'mp4', 'mime x-m4v -> mp4');
assert(videoExtensionFromMimeType('video/avi') === null, 'mime necunoscut -> null');
assert(videoExtensionFromMimeType(null) === null, 'mime lipsa -> null');
const cam = resolveVideoExtension({ mimeType: 'video/mp4', uri: 'content://media/video/1234' });
assert(cam.extension === 'mp4' && cam.from === 'mime', 'filmare content:// rezolvata din mime');
const gal = resolveVideoExtension({ mimeType: null, uri: 'file:///x/clip.MOV' });
assert(gal.extension === 'mov' && gal.from === 'uri', 'fallback pe extensia din uri');
const none = resolveVideoExtension({ mimeType: null, uri: 'content://media/video/1234' });
assert(none.extension === null && none.from === 'none', 'fara mime si fara extensie -> none');
assert(videoContentType('mov') === 'video/quicktime', 'content-type mov');
assert(videoContentType('mp4') === 'video/mp4', 'content-type mp4');
assert(videoContentType('webm') === 'video/webm', 'content-type webm');
assert(videoExtensionFromMimeType('video/webm') === 'webm', 'mime webm -> webm');
assert(
  validatePromoVideoAsset({ sizeBytes: 1024, durationMs: 10000, extension: 'webm' }) === null,
  'webm acceptat'
);
assert(
  (validatePromoVideoAsset({ sizeBytes: 1024, durationMs: 1000, extension: 'avi' }) ?? '').includes('WebM'),
  'mesajul de eroare mentioneaza WebM'
);
assert(
  (validatePromoVideoAsset({ sizeBytes: 1024, durationMs: 1000, extension: '3gp' }) ?? '').includes('3gp'),
  'mesajul de eroare arata formatul primit'
);

console.log(`videoRules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
