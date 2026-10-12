/**
 * Run: npx tsx lib/i18n.test.ts
 * from apps/mobile
 *
 * Durable RO/EN checks: dictionary parity, placeholder consistency,
 * and backend notification copy (both languages + lang parsing).
 */
import { en } from './locales/en';
import { ro } from './locales/ro';
import {
  messageApproved,
  messagePostpone,
  notifyLocale,
  parseNotifyLang,
} from '../../../supabase/functions/_shared/notify';

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

function varsOf(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\{([a-zA-Z_]+)\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out.sort();
}

// 1. parity: same key set in both dictionaries
const roKeys = Object.keys(ro).sort();
const enKeys = Object.keys(en).sort();
assert(
  roKeys.length === enKeys.length &&
    roKeys.every((k, i) => k === enKeys[i]),
  'ro/en au același set de chei',
  `ro=${roKeys.length} en=${enKeys.length}`
);

// 2. values: non-empty strings
let empty = 0;
for (const k of roKeys) {
  const rv = (ro as Record<string, unknown>)[k];
  const ev = (en as Record<string, unknown>)[k];
  if (typeof rv !== 'string' || !rv.trim()) empty += 1;
  if (typeof ev !== 'string' || !ev.trim()) empty += 1;
}
assert(empty === 0, 'nicio valoare goală', `${empty} goale`);

// 3. placeholders: every {var} in ro exists in en and vice versa
let phMismatch = 0;
for (const k of roKeys) {
  const rv = varsOf((ro as Record<string, string>)[k]);
  const ev = varsOf((en as Record<string, string>)[k]);
  if (rv.join(',') !== ev.join(',')) {
    phMismatch += 1;
    if (phMismatch <= 5) console.error(`  placeholder mismatch ${k}: ro={${rv}} en={${ev}}`);
  }
}
assert(phMismatch === 0, 'placeholders consecvenți', `${phMismatch} nepotriviri`);

// 4. backend lang parsing
assert(parseNotifyLang('en') === 'en', "parseNotifyLang('en')");
assert(parseNotifyLang('ro') === 'ro', "parseNotifyLang('ro')");
assert(parseNotifyLang(undefined) === 'ro', 'parseNotifyLang(undefined) → ro');
assert(parseNotifyLang('fr') === 'ro', "parseNotifyLang('fr') → ro");
assert(notifyLocale('en') === 'en-GB', "notifyLocale('en')");
assert(notifyLocale('ro') === 'ro-RO', "notifyLocale('ro')");

// 5. backend copy in both languages
const apRo = messageApproved('Salon', 'azi');
const apEn = messageApproved('Salon', 'today', 'en');
assert(apRo.subject === 'Programare confirmată', 'approved RO');
assert(apEn.subject === 'Booking confirmed', 'approved EN');
assert(apRo.text !== apEn.text, 'approved textele diferă');

const p1 = messagePostpone('Salon', 1, 'azi', 'Europe/Bucharest');
const p3 = messagePostpone('Salon', 3, 'azi', 'Europe/Bucharest');
const p1en = messagePostpone('Salon', 1, 'today', 'Europe/Bucharest', 'en');
const p3en = messagePostpone('Salon', 3, 'today', 'Europe/Bucharest', 'en');
assert(p1.subject.includes('1 oră'), 'postpone 1 oră', p1.subject);
assert(p3.subject.includes('3 ore'), 'postpone 3 ore (nu 2 ore)', p3.subject);
assert(p1en.subject.includes('1 hour'), 'postpone 1 hour', p1en.subject);
assert(p3en.subject.includes('3 hours'), 'postpone 3 hours', p3en.subject);

console.log(`i18n: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
