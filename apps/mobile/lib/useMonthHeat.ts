import { useEffect, useMemo, useRef, useState } from 'react';

import {
  businessMonthTones,
  clientMonthTones,
  countStaffIds,
  monthBoundsUtc,
  type CalendarMonth,
  type DayCapacity,
  type DayTone,
} from '@/lib/bookingCalendar';
import { listBusyRanges, listDayAppointmentCounts } from '@/lib/bookingRpc';
import { notBeforeUtc, staffSchedule } from '@/lib/bookingRules';
import { withoutOwnBusy } from '@/lib/rescheduleRequest';
import type { BusyRange } from '@/lib/slots';
import type { Appointment, BusinessProfile, Staff } from '@/lib/types';

/** De unde vin culorile calendarului. */
export type HeatSource =
  | {
      kind: 'client';
      business: BusinessProfile;
      /**
       * Specialiștii luați în calcul: unul ales, toți cei eligibili („Oricine”, reuniune)
       * sau [null] = firma fără echipă (programul firmei).
       */
      members: (Pick<Staff, 'id' | 'working_hours' | 'break_hours'> | null)[];
      durationMinutes: number;
      minYmd: string;
      maxYmd: string;
      /** Quick-add (business): fără preaviz minim, ca lista de ore de acolo. */
      ignoreMinNotice?: boolean;
      /** Reprogramare: ora curentă (și cea cerută) a programării nu se numără ca ocupată. */
      ownAppointment?: Pick<Appointment, 'start_at' | 'end_at' | 'requested_start_at' | 'requested_end_at'> | null;
    }
  | {
      kind: 'business';
      businessId: string;
      timezone: string;
      /** Programele luate în calcul (specialistul filtrat, toată echipa sau firma). */
      capacities: DayCapacity[];
      /** Filtrul de specialist; null = toți. */
      staffId: string | null;
      blockedDates: string[];
      /** Se schimbă la fiecare reîncărcare a ecranului, ca lunile din cache să fie recitite. */
      refreshKey: number;
    };

export type MonthHeat = { tones: Record<string, DayTone>; counts: Record<string, number> };

const EMPTY: MonthHeat = { tones: {}, counts: {} };

/** busy[i] = ocupările pentru members[i] (la business: un singur element). */
type Raw = { busy: BusyRange[][]; counts: Record<string, number> };

function memberIds(src: Extract<HeatSource, { kind: 'client' }>): string {
  return src.members.map((m) => m?.id ?? '-').join(',');
}

function sourceKey(src: HeatSource, view: CalendarMonth): string {
  const month = `${view.year}-${view.month}`;
  return src.kind === 'client'
    ? `c|${src.business.id}|${memberIds(src)}|${month}`
    : `b|${src.businessId}|${src.staffId ?? '-'}|${month}|${src.refreshKey}`;
}

/**
 * Culorile și numărul de programări pe zi pentru luna afișată (business și pagina publică).
 * O cerere de ocupări pe lună (per specialist) + una de numărare; lunile deja văzute rămân în cache.
 * O eroare lasă calendarul fără culori, nu îl blochează.
 */
export function useMonthHeat(source: HeatSource | null | undefined, view: CalendarMonth): MonthHeat {
  const cache = useRef(new Map<string, Raw>());
  const [raw, setRaw] = useState<{ key: string; data: Raw } | null>(null);
  const key = source ? sourceKey(source, view) : null;

  useEffect(() => {
    if (!source || !key) return;
    const hit = cache.current.get(key);
    if (hit) {
      setRaw({ key, data: hit });
      return;
    }
    let alive = true;
    void (async () => {
      const tz = source.kind === 'client' ? source.business.timezone : source.timezone;
      const businessId = source.kind === 'client' ? source.business.id : source.businessId;
      // list_busy_ranges nu spune al cui e intervalul, deci „Oricine” cere luna o dată per specialist, în paralel.
      const staffIds = source.kind === 'client' ? source.members.map((m) => m?.id ?? null) : [source.staffId];
      const { fromIso, toIso } = monthBoundsUtc(view, tz);
      const [busyRes, counts] = await Promise.all([
        Promise.all(staffIds.map((staffId) => listBusyRanges({ businessId, fromIso, toIso, staffId }))),
        listDayAppointmentCounts({ businessId, fromIso, toIso, staffIds: countStaffIds(staffIds) }),
      ]);
      if (busyRes.some((r) => r.error)) return;
      // Numărarea eșuată = necunoscut: fără cifre, culorile rămân, iar luna nu intră în cache.
      const data: Raw = { busy: busyRes.map((r) => r.busy), counts: counts ?? {} };
      if (counts) cache.current.set(key, data);
      if (alive) setRaw({ key, data });
    })();
    return () => {
      alive = false;
    };
    // `key` rezumă sursa și luna; restul câmpurilor sursei nu cer o cerere nouă.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const data = raw && raw.key === key ? raw.data : null;
  const client = source?.kind === 'client' ? source : null;
  const durationMinutes = client?.durationMinutes ?? 0;
  const own = client?.ownAppointment;
  const ownKey = own ? `${own.start_at}|${own.end_at}|${own.requested_start_at ?? ''}|${own.requested_end_at ?? ''}` : '';
  return useMemo(() => {
    if (!source || !data) return EMPTY;
    if (source.kind === 'business') {
      return {
        tones: businessMonthTones({
          month: view,
          timezone: source.timezone,
          capacities: source.capacities,
          busy: data.busy[0] ?? [],
          blockedDates: source.blockedDates,
        }),
        counts: data.counts,
      };
    }
    return {
      tones: clientMonthTones({
        month: view,
        timezone: source.business.timezone,
        members: source.members.map((m, i) => ({
          ...staffSchedule(m, source.business),
          busy: withoutOwnBusy(data.busy[i] ?? [], source.ownAppointment),
        })),
        durationMinutes,
        bufferMinutes: source.business.buffer_minutes ?? 0,
        blockedDates: source.business.blocked_dates ?? [],
        notBeforeUtc: source.ignoreMinNotice ? new Date() : notBeforeUtc(source.business),
        minYmd: source.minYmd,
        maxYmd: source.maxYmd,
      }),
      counts: data.counts,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, durationMinutes, ownKey]);
}
