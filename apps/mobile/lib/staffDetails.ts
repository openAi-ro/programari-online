/** Limite aliniate cu migrarea v65 (check-uri in DB). */
export const MAX_SPECIALTY_LENGTH = 60;
export const MAX_STAFF_PHONE_LENGTH = 20;

/** Text gol sau doar spatii -> null; altfel textul curatat, taiat la limita data. */
export function cleanOptionalText(value: string | null | undefined, max: number): string | null {
  const v = (value ?? '').trim().replace(/\s+/g, ' ');
  return v ? v.slice(0, max) : null;
}

/** Randul din public.staff_private pentru un specialist (fara telefon -> nu e public). */
export function staffPrivateRow(input: {
  staffId: string;
  phone: string | null | undefined;
  phonePublic: boolean;
}): { staff_id: string; phone: string | null; phone_public: boolean } {
  const phone = cleanOptionalText(input.phone, MAX_STAFF_PHONE_LENGTH);
  return { staff_id: input.staffId, phone, phone_public: phone ? input.phonePublic : false };
}
