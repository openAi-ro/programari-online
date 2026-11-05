/**
 * Run: npx tsx lib/giftCard.test.ts
 * from apps/mobile
 */
import {
  formatGiftCode,
  giftCardDisplayStatus,
  isGiftExpired,
  isValidGiftAmount,
  isValidGiftKind,
  mapGiftRpcError,
  normalizeGiftCode,
} from './giftCard';

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

assert(formatGiftCode('abcd1234efgh5678') === 'ABCD-1234-EFGH-5678', 'cod grupat 4-4-4-4', formatGiftCode('abcd1234efgh5678'));
assert(formatGiftCode('') === '', 'gol → gol');
assert(normalizeGiftCode(' abcd-1234 ') === 'ABCD1234', 'normalizează codul scris de client', normalizeGiftCode(' abcd-1234 '));
assert(normalizeGiftCode('ABCD-1234') === normalizeGiftCode('abcd1234'), 'cu și fără cratime → același cod');

assert(isValidGiftAmount(100) === true, '100 lei valid');
assert(isValidGiftAmount(0) === false, '0 invalid');
assert(isValidGiftAmount(-5) === false, 'negativ invalid');
assert(isValidGiftAmount(Number.NaN) === false, 'NaN invalid');

assert(isValidGiftKind('amount') === true, 'kind amount');
assert(isValidGiftKind('service') === true, 'kind service');
assert(isValidGiftKind('both') === false, 'kind invalid');

const now = new Date('2026-11-05T12:00:00.000Z');
assert(isGiftExpired(null, now) === false, 'NULL = nu expiră');
assert(isGiftExpired(undefined, now) === false, 'undefined = nu expiră');
assert(isGiftExpired('2026-11-06T00:00:00.000Z', now) === false, 'viitor = neexpirat');
assert(isGiftExpired('2026-11-05T11:00:00.000Z', now) === true, 'trecut = expirat');

assert(giftCardDisplayStatus({ status: 'redeemed', expires_at: null }, now) === 'redeemed', 'folosit');
assert(giftCardDisplayStatus({ status: 'cancelled', expires_at: null }, now) === 'cancelled', 'anulat');
assert(giftCardDisplayStatus({ status: 'active', expires_at: null }, now) === 'active', 'vechi fără expirare = nefolosit');
assert(
  giftCardDisplayStatus({ status: 'active', expires_at: '2026-11-01T00:00:00.000Z' }, now) === 'expired',
  'active + expirat → expired'
);
assert(
  giftCardDisplayStatus({ status: 'redeemed', expires_at: '2026-11-01T00:00:00.000Z' }, now) === 'redeemed',
  'folosit bate expirarea'
);

assert(mapGiftRpcError('gift_expired').length > 0 && !mapGiftRpcError('gift_expired').includes('gift_expired'), 'map expired translated');
assert(mapGiftRpcError('gift_not_unused').length > 0 && !mapGiftRpcError('gift_not_unused').includes('gift_not_unused'), 'map not unused translated');
assert(mapGiftRpcError('weird') === 'weird', 'map passthrough');

console.log(`giftCard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
