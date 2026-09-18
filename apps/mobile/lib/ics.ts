import { Platform, Share } from 'react-native';
import * as Linking from 'expo-linking';

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
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildIcs(opts: {
  id: string;
  title: string;
  description?: string;
  startIso: string;
  endIso: string;
}): string {
  const uid = `${opts.id}@programari`;
  const stamp = toIcsUtc(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Programari//RO',
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
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

export function googleCalendarUrl(opts: {
  title: string;
  details?: string;
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
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function addAppointmentToCalendar(opts: {
  id: string;
  title: string;
  description?: string;
  startIso: string;
  endIso: string;
}): Promise<void> {
  const ics = buildIcs(opts);
  const gcal = googleCalendarUrl(opts);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `programare-${opts.id.slice(0, 8)}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  try {
    await Share.share({
      message: `${opts.title}\nAdaugă în calendar:\n${gcal}`,
      url: gcal,
      title: opts.title,
    });
  } catch {
    await Linking.openURL(gcal);
  }
}
