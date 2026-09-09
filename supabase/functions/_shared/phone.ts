/**
 * Normalize phone numbers to E.164 for WhatsApp (Twilio / Meta).
 * Default country: Romania (+40).
 */
export function normalizePhoneE164(
  raw: string | null | undefined,
  defaultCountry = '40'
): string | null {
  if (!raw?.trim()) return null;

  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }

  // 07xxxxxxxx → +407xxxxxxxx
  if (digits.startsWith('0') && digits.length >= 10) {
    digits = defaultCountry + digits.slice(1);
  }

  // 7xxxxxxxx (9 digits RO mobile without 0)
  if (
    !digits.startsWith(defaultCountry) &&
    digits.length === 9 &&
    digits.startsWith('7')
  ) {
    digits = defaultCountry + digits;
  }

  if (digits.length < 10) return null;
  return `+${digits}`;
}

/** Meta Cloud API expects digits only, no + prefix. */
export function phoneForMetaApi(e164: string): string {
  return e164.replace(/^\+/, '');
}
