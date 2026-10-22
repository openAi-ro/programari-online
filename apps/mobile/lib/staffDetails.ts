/** Limite aliniate cu migrarea v65 (check-uri in DB). */
export const MAX_SPECIALTY_LENGTH = 60;
export const MAX_STAFF_PHONE_LENGTH = 20;
/** Aliniat cu migrarea v70 (staff_private_email_chk). */
export const MAX_STAFF_EMAIL_LENGTH = 254;

const STAFF_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Text gol sau doar spatii -> null; altfel textul curatat, taiat la limita data. */
export function cleanOptionalText(value: string | null | undefined, max: number): string | null {
  const v = (value ?? '').trim().replace(/\s+/g, ' ');
  return v ? v.slice(0, max) : null;
}

/** Email specialist: fara spatii la capete, litere mici; gol -> null. */
export function normalizeStaffEmail(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase();
  return v || null;
}

/** Gol e valid (campul e optional); altfel format simplu nume@domeniu.tld, max 254. */
export function isValidStaffEmail(value: string | null | undefined): boolean {
  const v = normalizeStaffEmail(value);
  return v === null || (v.length <= MAX_STAFF_EMAIL_LENGTH && STAFF_EMAIL_RE.test(v));
}

/** Randul din public.staff_private pentru un specialist (fara telefon -> nu e public). */
export function staffPrivateRow(input: {
  staffId: string;
  phone: string | null | undefined;
  phonePublic: boolean;
  email: string | null | undefined;
}): { staff_id: string; phone: string | null; phone_public: boolean; email: string | null } {
  const phone = cleanOptionalText(input.phone, MAX_STAFF_PHONE_LENGTH);
  return {
    staff_id: input.staffId,
    phone,
    phone_public: phone ? input.phonePublic : false,
    email: normalizeStaffEmail(input.email),
  };
}
