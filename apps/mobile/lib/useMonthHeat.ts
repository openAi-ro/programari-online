import { useEffect, useMemo, useRef, useState } from 'react';

import {
  businessMonthTones,
  clientMonthTones,
  countByDay,
  monthBoundsUtc,
  type CalendarMonth,
  type DayCapacity,
  type DayTone,
} from '@/lib/bookingCalendar';
import { listBusyRanges } from '@/lib/bookingRpc';
import { notBeforeUtc, staffSchedule } from '@/lib/bookingRules';
import { staffOrUnassignedFilter } from '@/lib/calendarStaffFilter';
import type { BusyRange } from '@/lib/slots';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile, Staff } from '@/lib/types';

/** De unde vin culorile calendarului. */
export type HeatSource =
  | {
      kind: 'client';
      business: BusinessProfile;
      /** null = firma fără echipă (programul firmei). */
      member: Pick<Staff, 'id' | 'working_hours' | 'break_hours'> | null;
      durationMinutes: number;
      minYmd: string;
      maxYmd: string;
      /** Quick-add (business): fără preaviz minim, ca lista de ore de acolo. */
      ignoreMinNotice?: boolean;
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

type Raw = { busy: BusyRange[]; counts: Record<string, number> };

function sourceKey(src: HeatSource, view: CalendarMonth): string {
  const month = `${view.year}-${view.month}`;
  return src.kind === 'client'
    ? `c|${src.business.id}|${src.member?.id ?? '-'}|${month}`
    : `b|${src.businessId}|${src.staffId ?? '-'}|${month}|${src.refreshKey}`;
}

/** Business: programările active ale lunii (doar start_at), pentru cifra de pe zi. */
async function loadMonthCounts(src: Extract<HeatSource, { kind: 'business' }>, view: CalendarMonth): Promise<Record<string, number>> {
  const { fromIso, toIso } = monthBoundsUtc(view, src.timezone);
  let query = supabase
    .from('appointments')
    .select('start_at')
    .eq('business_id', src.businessId)
    .in('status', ['pending', 'approved'])
    .gte('start_at', fromIso)
    .lt('start_at', toIso);
  if (src.staffId) {
    const staffOr = staffOrUnassignedFilter(src.staffId);
    if (staffOr) query = query.or(staffOr);
  }
  const { data, error } = await query;
  if (error) return {};
  return countByDay((data ?? []) as { start_at: string }[], src.timezone);
}

/**
 * Culorile (și la business numărul de programări) pentru luna afișată.
 * O cerere de ocupări pe lună (+ una de numărare la business); lunile deja văzute rămân în cache.
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
      const staffId = source.kind === 'client' ? source.member?.id ?? null : source.staffId;
      const { fromIso, toIso } = monthBoundsUtc(view, tz);
      const [busyRes, counts] = await Promise.all([
        listBusyRanges({ businessId, fromIso, toIso, staffId }),
        source.kind === 'business' ? loadMonthCounts(source, view) : Promise.resolve({}),
      ]);
      if (busyRes.error) return;
      const data: Raw = { busy: busyRes.busy, counts };
      cache.current.set(key, data);
      if (alive) setRaw({ key, data });
    })();
    return () => {
      alive = false;
    };
    // `key` rezumă sursa și luna; restul câmpurilor sursei nu cer o cerere nouă.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const data = raw && raw.key === key ? raw.data : null;
  const durationMinutes = source?.kind === 'client' ? source.durationMinutes : 0;
  return useMemo(() => {
    if (!source || !data) return EMPTY;
    if (source.kind === 'business') {
      return {
        tones: businessMonthTones({
          month: view,
          timezone: source.timezone,
          capacities: source.capacities,
          busy: data.busy,
          blockedDates: source.blockedDates,
        }),
        counts: data.counts,
      };
    }
    const hours = staffSchedule(source.member, source.business);
    return {
      tones: clientMonthTones({
        month: view,
        timezone: source.business.timezone,
        workingHours: hours.workingHours,
        breakHours: hours.breakHours,
        busy: data.busy,
        durationMinutes,
        bufferMinutes: source.business.buffer_minutes ?? 0,
        blockedDates: source.business.blocked_dates ?? [],
        notBeforeUtc: source.ignoreMinNotice ? new Date() : notBeforeUtc(source.business),
        minYmd: source.minYmd,
        maxYmd: source.maxYmd,
      }),
      counts: {},
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, durationMinutes]);
}
