/**
 * Run: npx tsx lib/walkin.test.ts
 * from apps/mobile
 */
import { normalizeWalkinContact, validateWalkinInput } from './walkinRules';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('walkin tests\n');

// 1) cere minim un contact
{
  const r = normalizeWalkinContact('', '');
  assert(r.error === 'walkin_contact_required', 'contact gol → walkin_contact_required');
}

// 2) telefon RO 07… normalizat E.164
{
  const r = normalizeWalkinContact('0722 123 456', '');
  assert(r.error === null, 'telefon RO valid trece');
  assert(r.contact.phone === '+40722123456', 'telefon normalizat +40', r.contact.phone ?? 'null');
}

// 3) telefon invalid raportat
{
  const r = normalizeWalkinContact('123', '');
  assert(r.error === 'invalid_phone', 'telefon scurt → invalid_phone');
}

// 4) email singur e suficient
{
  const r = normalizeWalkinContact('', 'client@salon.ro');
  assert(r.error === null && r.contact.email === 'client@salon.ro', 'email singur trece');
}

// 5) email invalid raportat
{
  const r = normalizeWalkinContact('', 'fara-@-sens');
  assert(r.error === 'invalid_email', 'email invalid → invalid_email');
}

// 6) validare slot lipsa
{
  const err = validateWalkinInput({ slotStartUtc: null, slotEndUtc: null, contactError: null });
  assert(err === 'walkin_slot_required', 'slot lipsa → walkin_slot_required');
}

// 7) eroarea de contact are prioritate dupa slot
{
  const err = validateWalkinInput({
    slotStartUtc: '2026-10-07T07:00:00.000Z',
    slotEndUtc: '2026-10-07T07:30:00.000Z',
    contactError: 'invalid_phone',
  });
  assert(err === 'invalid_phone', 'propaga eroarea de contact');
}

// 8) input complet trece
{
  const err = validateWalkinInput({
    slotStartUtc: '2026-10-07T07:00:00.000Z',
    slotEndUtc: '2026-10-07T07:30:00.000Z',
    contactError: null,
  });
  assert(err === null, 'input complet → null');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
