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

console.log(`bookingCalendar: ${n} passed, 0 failed`);