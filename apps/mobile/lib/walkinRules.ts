import { normalizePhoneE164 } from './phone';

export type WalkinContact = {
  phone: string | null;
  email: string | null;
};

/** Normalizeaza contactul walk-in: telefon E.164 sau email; cere minim unul. */
export function normalizeWalkinContact(
  rawPhone: string | null | undefined,
  rawEmail: string | null | undefined
): { contact: WalkinContact; error: string | null } {
  const email = rawEmail?.trim() ? rawEmail.trim() : null;
  const phone = normalizePhoneE164(rawPhone ?? null);
  if (rawPhone?.trim() && !phone) {
    return { contact: { phone: null, email }, error: 'invalid_phone' };
  }
  if (!phone && !email) {
    return { contact: { phone: null, email: null }, error: 'walkin_contact_required' };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { contact: { phone, email: null }, error: 'invalid_email' };
  }
  return { contact: { phone, email }, error: null };
}

export function validateWalkinInput(opts: {
  slotStartUtc: string | null;
  slotEndUtc: string | null;
  contactError: string | null;
}): string | null {
  if (!opts.slotStartUtc || !opts.slotEndUtc) return 'walkin_slot_required';
  if (opts.contactError) return opts.contactError;
  return null;
}
