import type { TrKey } from './i18n';

/** Codurile ridicate de RPC-urile de echipă (v89/v97) și de send-business-invite. */
const TEAM_ERROR_CODES = [
  'invalid_email',
  'already_member',
  'only_owner_invites_admin',
  'only_owner_manages_admin',
  'staff_already_linked',
  'invitation_expired',
  'invitation_not_found',
  'staff_not_found',
  'staff_required',
  'email_mismatch',
  'resend_too_soon',
  'cannot_invite_owner',
  'cannot_change_owner',
  'cannot_remove_owner',
  'member_not_found',
  'not_allowed',
  'not_business_member',
  'not_authenticated',
  'email_failed',
] as const;

export type TeamErrorCode = (typeof TEAM_ERROR_CODES)[number];

/** Găsește codul cunoscut într-un mesaj brut (PostgREST trimite „invalid_email” sau text în jurul lui). */
export function teamErrorCode(raw: string | null | undefined): TeamErrorCode | null {
  if (!raw) return null;
  return TEAM_ERROR_CODES.find((code) => new RegExp(`\\b${code}\\b`).test(raw)) ?? null;
}

/** Cheia de traducere pentru o eroare de echipă; necunoscutele devin mesaj generic. */
export function teamErrorKey(raw: string | null | undefined): TrKey {
  const code = teamErrorCode(raw);
  return code ? (`teamErr.${code}` as TrKey) : 'teamErr.generic';
}
