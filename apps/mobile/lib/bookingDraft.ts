/**
 * Rezervarea în curs pe web supraviețuiește unui refresh (test încrucișat, Auditor F-8):
 * serviciile, specialistul, ziua și ora aleasă se țin în sessionStorage (doar tabul curent,
 * 30 de minute). La revenire, ora se re-selectează doar dacă e încă liberă.
 */
export type DraftStep = 'staff' | 'service' | 'date' | 'slot' | 'confirm';

export type BookingDraft = {
  code: string;
  savedAt: number;
  serviceIds: string[];
  staffId: string | null;
  staffAny: boolean;
  dateLocal: string;
  step: DraftStep;
  slotStartUtc: string | null;
  /** „Oricine disponibil” pe /b/: ziua din calendarul fiecărui specialist (id → YYYY-MM-DD). */
  staffDates?: Record<string, string>;
};

export type RestoredDraft = Omit<BookingDraft, 'code' | 'savedAt' | 'step' | 'staffDates'> & {
  step: Exclude<DraftStep, 'confirm'>;
  staffDates: Record<string, string>;
};

export const DRAFT_KEY = 'programari.bookingDraft';
export const DRAFT_TTL_MS = 30 * 60_000;
const STEPS: DraftStep[] = ['staff', 'service', 'date', 'slot', 'confirm'];

export function restorableDraft(
  raw: string | null,
  ctx: { code: string; now: number; todayYmd: string; serviceIds: string[]; staffIds: string[] }
): RestoredDraft | null {
  if (!raw) return null;
  let d: Partial<BookingDraft>;
  try {
    d = JSON.parse(raw) as Partial<BookingDraft>;
  } catch {
    return null;
  }
  if (d.code !== ctx.code || typeof d.savedAt !== 'number' || ctx.now - d.savedAt > DRAFT_TTL_MS) return null;
  if (!d.step || !STEPS.includes(d.step)) return null;
  if (typeof d.dateLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.dateLocal) || d.dateLocal < ctx.todayYmd) return null;
  const serviceIds = Array.isArray(d.serviceIds) ? d.serviceIds.filter((id) => ctx.serviceIds.includes(id)) : [];
  if (ctx.serviceIds.length > 0 && serviceIds.length === 0) return null;
  const staffId = d.staffId && ctx.staffIds.includes(d.staffId) ? d.staffId : null;
  if (d.staffId && !staffId) return null;
  const staffAny = d.staffAny === true;
  // Ora se re-alege pe pasul de ore; „Oricine” are câte un calendar pe specialist, deci acolo
  // clientul alege din nou ora.
  const slotStartUtc = !staffAny && typeof d.slotStartUtc === 'string' ? d.slotStartUtc : null;
  const staffDates: Record<string, string> = {};
  if (staffAny && d.staffDates && typeof d.staffDates === 'object') {
    for (const [id, ymd] of Object.entries(d.staffDates)) {
      if (ctx.staffIds.includes(id) && typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd >= ctx.todayYmd) {
        staffDates[id] = ymd;
      }
    }
  }
  return {
    serviceIds,
    staffId,
    staffAny,
    dateLocal: d.dateLocal,
    step: d.step === 'confirm' ? 'slot' : d.step,
    slotStartUtc: d.step === 'confirm' || d.step === 'slot' ? slotStartUtc : null,
    staffDates,
  };
}

/**
 * Ziua afișată când se schimbă specialistul/serviciile: ziua aleasă de client (inclusiv cea
 * din draft după refresh) rămâne dacă se mai poate rezerva; altfel prima zi rezervabilă.
 */
export function defaultBookingDate(picked: string | null, firstBookable: string): string {
  return picked && picked >= firstBookable ? picked : firstBookable;
}

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function readDraft(): string | null {
  try {
    return store()?.getItem(DRAFT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeDraft(d: BookingDraft): void {
  try {
    store()?.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // best effort
  }
}

export function clearDraft(): void {
  try {
    store()?.removeItem(DRAFT_KEY);
  } catch {
    // best effort
  }
}
