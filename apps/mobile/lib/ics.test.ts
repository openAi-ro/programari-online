/**
 * Run: npx tsx lib/ics.test.ts
 * from apps/mobile
 */
import { buildIcs, foldIcsLine, googleCalendarUrl, toIcsUtc } from './icsFormat';

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

function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

assert(
  toIcsUtc('2026-10-19T07:30:00.000Z') === '20261019T073000Z',
  'timestamp UTC formatat corect',
  toIcsUtc('2026-10-19T07:30:00.000Z'),
);

const ics = buildIcs({
  id: 'abc-123',
  title: 'Programare la Salon Înfrumusețare, etaj 2; sala mare',
  description: 'Tuns\nProgramare confirmată',
  location: 'Strada Memorandumului 12, Cluj-Napoca, Jud. Cluj',
  startIso: '2026-10-19T07:00:00.000Z',
  endIso: '2026-10-19T08:00:00.000Z',
});

assert(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'începe cu VCALENDAR și CRLF');
assert(ics.includes('UID:abc-123@programari'), 'UID stabil din id');
assert(ics.includes('DTSTART:20261019T070000Z'), 'DTSTART în UTC');
assert(ics.includes('DTEND:20261019T080000Z'), 'DTEND în UTC');
assert(ics.includes('STATUS:CONFIRMED'), 'status confirmat');
assert(ics.includes('LOCATION:Strada Memorandumului 12\\, Cluj-Napoca\\, Jud. Cluj'), 'locație escapata');
assert(ics.includes('DESCRIPTION:Tuns\\nProgramare confirmată'), 'newline escapat în descriere');
assert(ics.includes('\\; sala mare'), 'punct și virgulă escapat în titlu');
assert(ics.includes('BEGIN:VALARM') && ics.includes('TRIGGER:-PT60M'), 'reamintire cu 60 de minute înainte');

for (const line of ics.split('\r\n')) {
  assert(utf8Len(line) <= 75, 'linie fizică de cel mult 75 de octeți', `${utf8Len(line)}: ${line}`);
}

const longTitle = `SUMMARY:${'Ă'.repeat(60)}`;
const folded = foldIcsLine(longTitle);
assert(folded.length > 1, 'linia lungă cu diacritice se împăturește');
assert(
  folded.every((l, i) => utf8Len(l) <= 75 && (i === 0 || l.startsWith(' '))),
  'continuările încep cu spațiu și respectă limita',
  folded.join('|'),
);
assert(
  folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('') === longTitle,
  'împăturirea nu pierde și nu modifică conținutul',
);

const noAlarm = buildIcs({
  id: 'x',
  title: 'Fără alarmă',
  startIso: '2026-10-19T07:00:00.000Z',
  endIso: '2026-10-19T08:00:00.000Z',
  alarmMinutesBefore: 0,
});
assert(!noAlarm.includes('VALARM'), 'alarmă dezactivată la 0 minute');

const url = googleCalendarUrl({
  title: 'Programare la Salon',
  details: 'Tuns',
  location: 'Strada Memorandumului 12, Cluj-Napoca',
  startIso: '2026-10-19T07:00:00.000Z',
  endIso: '2026-10-19T08:00:00.000Z',
});
const parsed = new URL(url);
assert(parsed.searchParams.get('action') === 'TEMPLATE', 'URL Google de tip TEMPLATE');
assert(
  parsed.searchParams.get('dates') === '20261019T070000Z/20261019T080000Z',
  'interval UTC în URL Google',
  parsed.searchParams.get('dates') ?? '',
);
assert(
  parsed.searchParams.get('location') === 'Strada Memorandumului 12, Cluj-Napoca',
  'locație în URL Google',
);

console.log(`ics: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
