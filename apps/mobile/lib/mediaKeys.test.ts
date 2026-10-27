/**
 * Run: npx tsx lib/mediaKeys.test.ts
 * from apps/mobile
 */
import { chatMessagePreview, mediaKeyFromUrl, planChatAttachment } from './mediaKeys';

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

const biz = '0e1d5765-4741-4685-97aa-50bb2ded3f59';
assert(
  mediaKeyFromUrl('business-media', `https://programari-media.rafaeldanescu.workers.dev/m/business-media/${biz}/1-2.jpg`) === `${biz}/1-2.jpg`,
  'worker url -> key'
);
assert(
  mediaKeyFromUrl('business-media', `https://x.supabase.co/storage/v1/object/public/business-media/${biz}/1-2.jpg?t=1`) === `${biz}/1-2.jpg`,
  'old supabase url -> key'
);
assert(mediaKeyFromUrl('business-media', `https://w.dev/m/business-logos/${biz}/a.jpg`) === null, 'other bucket -> null');
assert(mediaKeyFromUrl('business-media', `https://w.dev/m/business-media/${biz}/../x/a.jpg`) === null, 'traversal -> null');
assert(mediaKeyFromUrl('business-media', `https://w.dev/m/business-media/a.jpg`) === null, 'missing folder -> null');

const labels = { image: 'Photo', video: 'Video' };
assert(chatMessagePreview({ body: ' hi  there ' }, labels) === 'hi there', 'text preview');
assert(chatMessagePreview({ body: '', attachment_kind: 'video' }, labels) === 'Video', 'bare video preview');
assert(chatMessagePreview({ body: 'look', attachment_kind: 'image' }, labels) === 'Photo · look', 'captioned photo');

const ok = planChatAttachment({ pickerType: 'video', mimeType: 'video/mp4', sizeBytes: 1000, durationMs: 30000 });
assert(ok.ok && ok.kind === 'video' && ok.ext === 'mp4', '30 s mp4 accepted');
const long = planChatAttachment({ pickerType: 'video', mimeType: 'video/mp4', sizeBytes: 1000, durationMs: 31000 });
assert(!long.ok && long.error === 'too_long', '31 s rejected');
const big = planChatAttachment({ pickerType: 'image', mimeType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024, durationMs: null });
assert(!big.ok && big.error === 'too_big', '11 MB photo rejected');
const heic = planChatAttachment({ pickerType: 'image', mimeType: 'image/heic', sizeBytes: 1000, durationMs: null });
assert(!heic.ok && heic.error === 'type', 'heic rejected');
const noMime = planChatAttachment({ pickerType: 'image', mimeType: null, sizeBytes: null, durationMs: null });
assert(noMime.ok && noMime.mime === 'image/jpeg', 'missing mime falls back to picker type');
const mov = planChatAttachment({ pickerType: 'video', mimeType: 'video/quicktime', sizeBytes: 40 * 1024 * 1024, durationMs: 12000 });
assert(mov.ok && mov.ext === 'mov', 'mov under 50 MB accepted');

console.log(`mediaKeys: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
