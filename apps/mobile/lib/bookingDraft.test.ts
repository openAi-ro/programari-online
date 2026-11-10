/**
 * Run: npx tsx lib/bookingDraft.test.ts  (din apps/mobile)
 * Test încrucișat, Auditor F-8: refresh la confirmare nu mai trimite clientul la pasul 1.
 */
import { DRAFT_TTL_MS, defaultBookingDate, restorableDraft, type BookingDraft } from './bookingDraft';

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: got ${a}, expected ${e}`);
  }
}

const now = Date.parse('2026-11-12T10:00:00Z');
const ctx = { code: 'salontestloc1', now, todayYmd: '2026-11-12', serviceIds: ['svc1', 'svc2'], staffIds: ['st1', 'st2'] };
const base: BookingDraft = {
  code: 'salontestloc1',
  savedAt: now - 60_000,
  serviceIds: ['svc1'],
  staffId: 'st1',
  staffAny: false,
  dateLocal: '2026-11-13',
  step: 'confirm',
  slotStartUtc: '2026-11-13T09:00:00.000Z',
};
const raw = (d: Partial<BookingDraft>) => JSON.stringify({ ...base, ...d });

eq(restorableDraft(raw({}), ctx), { serviceIds: ['svc1'], staffId: 'st1', staffAny: false, dateLocal: '2026-11-13', step: 'slot', slotStartUtc: '2026-11-13T09:00:00.000Z' }, 'confirmare → pasul de ore cu ora de re-selectat');
eq(restorableDraft(raw({ step: 'date', slotStartUtc: null }), ctx)?.step, 'date', 'pasul de dată rămâne');
eq(restorableDraft(raw({ step: 'date' }), ctx)?.slotStartUtc, null, 'pe pasul de dată nu se re-selectează o oră');
eq(restorableDraft(raw({ code: 'alt-salon' }), ctx), null, 'alt salon → nimic');
eq(restorableDraft(raw({ savedAt: now - DRAFT_TTL_MS - 1 }), ctx), null, 'mai vechi de 30 min → nimic');
eq(restorableDraft(raw({ dateLocal: '2026-11-11' }), ctx), null, 'zi trecută → nimic');
eq(restorableDraft(raw({ serviceIds: ['sters'] }), ctx), null, 'serviciu șters → nimic');
eq(restorableDraft(raw({ staffId: 'plecat' }), ctx), null, 'specialist scos din echipă → nimic');
eq(restorableDraft(raw({ staffAny: true, staffId: null }), ctx)?.slotStartUtc, null, '„Oricine” → ora se alege din nou');
eq(restorableDraft('nu e json', ctx), null, 'JSON stricat → nimic');
eq(restorableDraft(null, ctx), null, 'fără ciornă');

// Retest 3.24, R-1: după refresh ziua din draft (13.11) nu mai sare pe prima zi rezervabilă (azi).
const restored = restorableDraft(raw({}), ctx);
eq(defaultBookingDate(restored?.dateLocal ?? null, '2026-11-12'), '2026-11-13', 'ziua din draft rămâne după refresh');
eq(defaultBookingDate(null, '2026-11-12'), '2026-11-12', 'fără alegere → prima zi rezervabilă');
eq(defaultBookingDate('2026-11-13', '2026-11-14'), '2026-11-14', 'ziua aleasă nu mai e rezervabilă → prima zi posibilă');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
