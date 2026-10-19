import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

import { buildIcs, googleCalendarUrl, type IcsEventInput } from './icsFormat';

export { buildIcs, googleCalendarUrl, toIcsUtc } from './icsFormat';
export type { IcsEventInput } from './icsFormat';

/**
 * Rezultatul adăugării în calendar, ca ecranul să arate mesajul corect:
 * - `added`   — eveniment scris direct în calendarul telefonului
 * - `file`    — fișier .ics oferit prin meniul de partajare al sistemului
 * - `download`— fișier .ics descărcat (web)
 * - `google`  — s-a deschis Google Calendar ca ultimă variantă
 * - `failed`  — nimic nu a reușit; ecranul cere utilizatorului să mai încerce
 */
export type AddToCalendarResult = 'added' | 'file' | 'download' | 'google' | 'failed';

type CalendarEventInput = IcsEventInput;

async function addToDeviceCalendar(opts: CalendarEventInput): Promise<boolean> {
  try {
    // Import dinamic: build-urile vechi (fără modulul nativ) nu se blochează
    // la încărcare, ci cad pe varianta cu fișier .ics.
    const Calendar = await import('expo-calendar');
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (!perm.granted) return false;
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const target =
      calendars.find((c) => c.allowsModifications && c.isPrimary) ??
      calendars.find((c) => c.allowsModifications);
    if (!target) return false;
    await Calendar.createEventAsync(target.id, {
      title: opts.title,
      startDate: new Date(opts.startIso),
      endDate: new Date(opts.endIso),
      location: opts.location,
      notes: opts.description,
      alarms: [{ relativeOffset: -60 }],
    });
    return true;
  } catch {
    return false;
  }
}

async function shareIcsFile(opts: CalendarEventInput): Promise<boolean> {
  try {
    const [FileSystem, Sharing] = await Promise.all([
      import('expo-file-system/legacy'),
      import('expo-sharing'),
    ]);
    if (!(await Sharing.isAvailableAsync())) return false;
    const dir = FileSystem.cacheDirectory;
    if (!dir) return false;
    const uri = `${dir}programare-${opts.id.slice(0, 8)}.ics`;
    await FileSystem.writeAsStringAsync(uri, buildIcs(opts));
    await Sharing.shareAsync(uri, {
      mimeType: 'text/calendar',
      dialogTitle: opts.title,
    });
    return true;
  } catch {
    return false;
  }
}

function downloadIcsOnWeb(opts: CalendarEventInput): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const blob = new Blob([buildIcs(opts)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `programare-${opts.id.slice(0, 8)}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Eliberarea imediată poate anula descărcarea în unele browsere.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

async function openGoogleCalendar(opts: CalendarEventInput): Promise<boolean> {
  try {
    await Linking.openURL(
      googleCalendarUrl({
        title: opts.title,
        details: opts.description,
        location: opts.location,
        startIso: opts.startIso,
        endIso: opts.endIso,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function addAppointmentToCalendar(
  opts: CalendarEventInput,
): Promise<AddToCalendarResult> {
  const start = new Date(opts.startIso).getTime();
  const end = new Date(opts.endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'failed';

  if (Platform.OS === 'web') {
    if (downloadIcsOnWeb(opts)) return 'download';
    return (await openGoogleCalendar(opts)) ? 'google' : 'failed';
  }

  if (await addToDeviceCalendar(opts)) return 'added';
  if (await shareIcsFile(opts)) return 'file';
  return (await openGoogleCalendar(opts)) ? 'google' : 'failed';
}
