/**
 * Formatare iCalendar (RFC 5545) — funcții pure, fără React Native,
 * ca să poată fi testate cu tsx (lib/ics.test.ts).
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC ICS timestamp: 20260803T060000Z */
export function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function utf8Bytes(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Împăturește o linie logică în linii fizice de cel mult 75 de octeți
 * (RFC 5545 §3.1), fără să rupă un caracter multioctet sau o pereche
 * de escape `\x`. Continuările încep cu un spațiu.
 */
export function foldIcsLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  const limit = () => (out.length === 0 ? 75 : 74);
  for (const ch of line) {
    const b = utf8Bytes(ch);
    if (bytes + b > limit()) {
      // Nu lăsa un backslash singur la capăt de linie.
      if (current.endsWith('\\') && current.length > 1) {
        out.push((out.length === 0 ? '' : ' ') + current.slice(0, -1));
        current = '\\';
        bytes = 1;
      } else {
        out.push((out.length === 0 ? '' : ' ') + current);
        current = '';
        bytes = 0;
      }
    }
    current += ch;
    bytes += b;
  }
  out.push((out.length === 0 ? '' : ' ') + current);
  return out;
}

export type IcsEventInput = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startIso: string;
  endIso: string;
  /** Cu câte minute înainte sună reamintirea; implicit 60. */
  alarmMinutesBefore?: number;
};

export function buildIcs(opts: IcsEventInput): string {
  const uid = `${opts.id}@programari`;
  const stamp = toIcsUtc(new Date().toISOString());
  const alarm = opts.alarmMinutesBefore ?? 60;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Programari//Calendar//RO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(opts.startIso)}`,
    `DTEND:${toIcsUtc(opts.endIso)}`,
    `SUMMARY:${escapeIcs(opts.title)}`,
  ];
  if (opts.description) {
    lines.push(`DESCRIPTION:${escapeIcs(opts.description)}`);
  }
  if (opts.location) {
    lines.push(`LOCATION:${escapeIcs(opts.location)}`);
  }
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE');
  if (alarm > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-PT${alarm}M`,
      `DESCRIPTION:${escapeIcs(opts.title)}`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.flatMap(foldIcsLine).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(opts: {
  title: string;
  details?: string;
  location?: string;
  startIso: string;
  endIso: string;
}): string {
  const dates = `${toIcsUtc(opts.startIso)}/${toIcsUtc(opts.endIso)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates,
  });
  if (opts.details) params.set('details', opts.details);
  if (opts.location) params.set('location', opts.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
