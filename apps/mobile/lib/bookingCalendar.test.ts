import {
  addMonths,
  bookingDateRange,
  canGoNextMonth,
  canGoPrevMonth,
  CALENDAR_MONTHS_RO,
  CALENDAR_WEEKDAYS_RO,
  dayKeyOfYmd,
  isDayDisabled,
  isOpenOnDay,
  monthGrid,
  monthOfYmd,
  availabilityTone,
  businessMonthTones,
  clientMonthTones,
  countStaffIds,
  dayOccupancy,
  monthBoundsUtc,
  monthDays,
  occupancyTone,
} from './bookingCalendar';
import type { WorkingHours } from './types';

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}
let n = 0;
const ok = (c: boolean, l: string) => {
  assert(c, l);
  n += 1;
};

const open = (start: string, end: string) => ({ closed: false as const, start, end });
const closed = { closed: true as const };
const weekdaysOnly: WorkingHours = {
  mon: open('09:00', '17:00'),
  tue: open('09:00', '17:00'),
  wed: open('09:00', '17:00'),
  thu: open('09:00', '17:00'),
  fri: open('09:00', '17:00'),
  sat: closed,
  sun: closed,
};
const saturdayNight: WorkingHours = { ...weekdaysOnly, mon: closed, sat: open('22:00', '02:00') };

// Etichete
ok(CALENDAR_WEEKDAYS_RO.join(' ') === 'Lu Ma Mi Jo Vi Sâ Du', 'saptamana incepe luni');
ok(CALENDAR_MONTHS_RO[9] === 'Octombrie' && CALENDAR_MONTHS_RO.length === 12, 'luni in romana');

// Grila: octombrie 2026 începe joi -> 3 căsuțe goale; 31 zile
const oct = monthGrid({ year: 2026, month: 9 });
ok(oct[0].slice(0, 3).every((c) => c === null) && oct[0][3] === '2026-10-01', '1 oct 2026 = joi');
ok(oct.every((r) => r.length === 7), 'randuri de 7');
ok(oct.flat().filter(Boolean).length === 31, 'octombrie are 31 zile');
// Februarie 2027 începe luni -> fără căsuțe goale, 28 zile, exact 4 rânduri
const feb27 = monthGrid({ year: 2027, month: 1 });
ok(feb27[0][0] === '2027-02-01' && feb27.length === 4, 'feb 2027: luni, 4 randuri');
ok(monthGrid({ year: 2028, month: 1 }).flat().filter(Boolean).length === 29, 'an bisect');
// Martie 2026 începe duminică -> 6 căsuțe goale (schimbare de oră în lună, fără efect)
const mar = monthGrid({ year: 2026, month: 2 });
ok(mar[0][6] === '2026-03-01' && mar.flat().includes('2026-03-29') && mar.flat().includes('2026-03-31'), 'martie cu DST');
ok(dayKeyOfYmd('2026-10-25') === 'sun' && dayKeyOfYmd('2026-10-26') === 'mon', 'ziua saptamanii la schimbarea orei');

// Navigare luni
ok(addMonths({ year: 2026, month: 11 }, 1).year === 2027 && addMonths({ year: 2026, month: 11 }, 1).month === 0, 'dec -> ian');
ok(addMonths({ year: 2026, month: 0 }, -1).year === 2025 && addMonths({ year: 2026, month: 0 }, -1).month === 11, 'ian -> dec');
ok(!canGoPrevMonth({ year: 2026, month: 9 }, '2026-10-20'), 'inapoi blocat in luna curenta');
ok(canGoPrevMonth({ year: 2026, month: 10 }, '2026-10-20'), 'inapoi activ din luna urmatoare');
ok(canGoNextMonth({ year: 2026, month: 9 }, '2027-01-18'), 'inainte activ sub limita');
ok(!canGoNextMonth({ year: 2027, month: 0 }, '2027-01-18'), 'inainte blocat la luna limitei');

// Interval
const r = bookingDateRange({ max_advance_days: 30, timezone: 'Europe/Bucharest' });
const days = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 86400000);
ok(days(r.minYmd, r.maxYmd) === 30, 'limita = azi + max_advance_days');
const r90 = bookingDateRange({ max_advance_days: null as unknown as number, timezone: 'Europe/Bucharest' });
ok(days(r90.minYmd, r90.maxYmd) === 90, 'fallback 90 zile');
ok(/^\d{4}-\d{2}-\d{2}$/.test(r.minYmd), 'format YYYY-MM-DD');

// Zile dezactivate
const rules = { minYmd: '2026-10-20', maxYmd: '2026-11-18', blockedDates: ['2026-10-22'], schedules: [weekdaysOnly] };
ok(isDayDisabled('2026-10-19', rules), 'trecut -> dezactivat');
ok(!isDayDisabled('2026-10-20', rules), 'azi (marti) -> activ');
ok(isDayDisabled('2026-10-22', rules), 'zi blocata -> dezactivat');
ok(isDayDisabled('2026-10-24', rules), 'sambata inchis -> dezactivat');
ok(!isDayDisabled('2026-11-18', rules), 'ultima zi din limita -> activ');
ok(isDayDisabled('2026-11-19', rules), 'peste limita -> dezactivat');

// Program peste noapte: deschis în ziua de start, nu și a doua zi
ok(isOpenOnDay('2026-10-24', [saturdayNight]), 'sambata 22-02 -> sambata deschis');
ok(!isOpenOnDay('2026-10-25', [saturdayNight]), 'duminica ramane inchisa');
// Oricine: deschis dacă măcar un specialist lucrează
ok(isOpenOnDay('2026-10-24', [weekdaysOnly, saturdayNight]), 'oricine: sambata deschis prin al doilea');
ok(!isOpenOnDay('2026-10-26', [saturdayNight]) && isOpenOnDay('2026-10-26', [weekdaysOnly, saturdayNight]), 'specialist ales vs oricine');
ok(!isOpenOnDay('2026-10-20', []), 'fara program -> inchis');
ok(monthOfYmd('2026-01-05').month === 0, 'luna din ymd');


// --- Culorile zilelor (varianta A) ---
const TZ = 'Europe/Bucharest';
ok(occupancyTone(null) === 'closed', 'null -> inchis');
ok(occupancyTone(0) === 'free' && occupancyTone(0.39) === 'free', 'sub 40% -> libera');
ok(occupancyTone(0.4) === 'moderate' && occupancyTone(0.74) === 'moderate', '40-75% -> medie');
ok(occupancyTone(0.75) === 'almostFull' && occupancyTone(0.94) === 'almostFull', '75-95% -> aproape plina');
ok(occupancyTone(0.95) === 'full' && occupancyTone(1) === 'full', '95%+ -> plina');
ok(occupancyTone(Number.NaN) === 'closed', 'NaN -> inchis');

ok(availabilityTone(0, 0) === 'closed', 'fara ore posibile -> inchis');
ok(availabilityTone(0, 8) === 'full', 'nimic liber -> plin');
ok(availabilityTone(2, 8) === 'almostFull', '2 ore ramase -> putine');
ok(availabilityTone(3, 16) === 'almostFull', '3 din 16 (19%) -> putine');
ok(availabilityTone(3, 8) === 'free', '3 din 8 -> sunt locuri');
ok(availabilityTone(1, 1) === 'almostFull', 'o singura ora ramasa -> putine');

const noBreak = { enabled: false, start: '13:00', end: '14:00' };
const lunch = { enabled: true, start: '13:00', end: '14:00' };
// Luni 2026-11-16, 09:00-17:00 = 480 min; cu pauza 420 min.
const mon = '2026-11-16';
const at = (hm: string) => new Date(`${mon}T${hm}:00+02:00`).toISOString();
ok(dayOccupancy(mon, TZ, [{ workingHours: weekdaysOnly, breakHours: noBreak }], []) === 0, 'zi goala -> 0');
const half = dayOccupancy(mon, TZ, [{ workingHours: weekdaysOnly, breakHours: noBreak }], [{ startUtc: at('09:00'), endUtc: at('13:00') }]);
ok(Math.abs((half ?? 0) - 0.5) < 1e-9, '4h din 8h -> 50%');
const withBreak = dayOccupancy(mon, TZ, [{ workingHours: weekdaysOnly, breakHours: lunch }], [{ startUtc: at('09:00'), endUtc: at('12:30') }]);
ok(Math.abs((withBreak ?? 0) - 210 / 420) < 1e-9, 'pauza scoasa din capacitate');
const overlap = dayOccupancy(mon, TZ, [{ workingHours: weekdaysOnly, breakHours: noBreak }], [
  { startUtc: at('09:00'), endUtc: at('11:00') },
  { startUtc: at('10:00'), endUtc: at('12:00') },
]);
ok(Math.abs((overlap ?? 0) - 180 / 480) < 1e-9, 'un program: suprapunerile nu se numara de doua ori');
const outside = dayOccupancy(mon, TZ, [{ workingHours: weekdaysOnly, breakHours: noBreak }], [{ startUtc: at('06:00'), endUtc: at('10:00') }]);
ok(Math.abs((outside ?? 0) - 60 / 480) < 1e-9, 'ocuparea taiata la programul zilei');
const timeOff = dayOccupancy(mon, TZ, [{ workingHours: weekdaysOnly, breakHours: noBreak }], [
  { startUtc: new Date(`${mon}T00:00:00+02:00`).toISOString(), endUtc: new Date('2026-11-17T00:00:00+02:00').toISOString() },
]);
ok(timeOff === 1, 'concediu toata ziua -> plina');
const team = dayOccupancy(mon, TZ, [
  { workingHours: weekdaysOnly, breakHours: noBreak },
  { workingHours: weekdaysOnly, breakHours: noBreak },
], [
  { startUtc: at('09:00'), endUtc: at('17:00') },
]);
ok(Math.abs((team ?? 0) - 0.5) < 1e-9, 'doi specialisti, unul plin -> 50%');
ok(dayOccupancy('2026-11-15', TZ, [{ workingHours: weekdaysOnly, breakHours: noBreak }], []) === null, 'duminica inchis -> null');
ok(dayOccupancy(mon, TZ, [{ workingHours: weekdaysOnly, breakHours: noBreak }], [], [mon]) === null, 'zi blocata -> null');
ok(dayOccupancy(mon, TZ, [], []) === null, 'fara programe -> null');

const nov = { year: 2026, month: 10 };
ok(monthDays(nov).length === 30 && monthDays(nov)[0] === '2026-11-01', 'zilele lunii');
const bounds = monthBoundsUtc(nov, TZ);
ok(bounds.fromIso === '2026-10-31T22:00:00.000Z' && bounds.toIso === '2026-11-30T22:00:00.000Z', 'limitele lunii in fusul firmei');
ok(countStaffIds([null]) === null && countStaffIds([]) === null, 'cifra: firma fara echipa = toata firma');
ok(countStaffIds(['s1', null]) === null, 'cifra: un calendar fara specialist = toata firma');
ok(JSON.stringify(countStaffIds(['s1', 's2', 's1'])) === '["s1","s2"]', 'cifra: specialistii calendarului, fara dubluri');

const bTones = businessMonthTones({
  month: nov,
  timezone: TZ,
  capacities: [{ workingHours: weekdaysOnly, breakHours: noBreak }],
  busy: [{ startUtc: at('09:00'), endUtc: at('17:00') }],
});
ok(bTones[mon] === 'full' && bTones['2026-11-17'] === 'free' && bTones['2026-11-15'] === 'closed', 'tonuri business pe luna');

const cTones = clientMonthTones({
  month: nov,
  timezone: TZ,
  members: [{ workingHours: weekdaysOnly, breakHours: noBreak, busy: [{ startUtc: at('09:00'), endUtc: at('15:00') }] }],
  durationMinutes: 60,
  notBeforeUtc: new Date('2026-11-01T00:00:00Z'),
  minYmd: '2026-11-10',
  maxYmd: '2026-11-20',
});
ok(cTones[mon] === 'almostFull', 'client: 2 ore ramase din 8 -> putine');
ok(cTones['2026-11-17'] === 'free', 'client: zi libera -> sunt locuri');
ok(cTones['2026-11-15'] === 'closed', 'client: duminica -> inchis');
ok(cTones['2026-11-09'] === undefined && cTones['2026-11-21'] === undefined, 'client: in afara intervalului fara ton');
const cLong = clientMonthTones({
  month: nov,
  timezone: TZ,
  members: [{ workingHours: weekdaysOnly, breakHours: noBreak, busy: [{ startUtc: at('09:00'), endUtc: at('15:00') }] }],
  durationMinutes: 180,
  notBeforeUtc: new Date('2026-11-01T00:00:00Z'),
  minYmd: '2026-11-10',
  maxYmd: '2026-11-20',
});
ok(cLong[mon] === 'full', 'client: serviciu de 3h nu mai incape -> plin');


// Oricine: reuniunea specialistilor eligibili
const anyBase = {
  month: nov,
  timezone: TZ,
  durationMinutes: 60,
  notBeforeUtc: new Date('2026-11-01T00:00:00Z'),
  minYmd: '2026-11-10',
  maxYmd: '2026-11-20',
};
const fullDay = [{ startUtc: at('09:00'), endUtc: at('17:00') }];
const anyOneFree = clientMonthTones({
  ...anyBase,
  members: [
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: fullDay },
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: [] },
  ],
});
ok(anyOneFree[mon] === 'free', 'oricine: unul plin + unul liber -> sunt locuri');
const anyNone = clientMonthTones({
  ...anyBase,
  members: [
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: fullDay },
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: fullDay },
  ],
});
ok(anyNone[mon] === 'full', 'oricine: toti plini -> plin');
const anyFew = clientMonthTones({
  ...anyBase,
  members: [
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: fullDay },
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: [{ startUtc: at('09:00'), endUtc: at('16:00') }] },
  ],
});
ok(anyFew[mon] === 'almostFull', 'oricine: o singura ora libera in total -> putine');
const anyShare = clientMonthTones({
  ...anyBase,
  members: [
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: fullDay },
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: fullDay },
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: [{ startUtc: at('09:00'), endUtc: at('13:00') }] },
  ],
});
ok(anyShare[mon] === 'almostFull', 'oricine: 4 libere din 24 (<=25%) -> putine');
const anyOffDay = clientMonthTones({
  ...anyBase,
  members: [
    { workingHours: weekdaysOnly, breakHours: noBreak, busy: [] },
    { workingHours: { ...weekdaysOnly, mon: closed }, breakHours: noBreak, busy: [] },
  ],
});
ok(anyOffDay[mon] === 'free', 'oricine: un specialist liber luni, celalalt nu lucreaza -> sunt locuri');
ok(anyOffDay['2026-11-15'] === 'closed', 'oricine: nimeni nu lucreaza duminica -> inchis');
ok(clientMonthTones({ ...anyBase, members: [] })[mon] === 'closed', 'oricine: fara specialisti -> inchis');

console.log(`bookingCalendar: ${n} passed, 0 failed`);