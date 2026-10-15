/**
 * Decide cui ii este adresat mesajul rapid trimis de business dintr-o
 * programare. Conversatia corecta este (business_id, clientul programarii),
 * niciodata (business_id, owner) — aceea e o conversatie cu sine insusi.
 */
export type BusinessChatTarget =
  | { kind: 'ok'; clientUserId: string }
  | { kind: 'guest' }
  | { kind: 'self' };

export function resolveBusinessChatTarget(
  appointment: { client_user_id: string | null },
  ownerUserId: string
): BusinessChatTarget {
  const clientUserId = appointment.client_user_id;
  if (!clientUserId) return { kind: 'guest' };
  if (clientUserId === ownerUserId) return { kind: 'self' };
  return { kind: 'ok', clientUserId };
}
