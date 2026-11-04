/**
 * Banner „Salonul ți-a mutat programarea" (audit F-12, v105).
 * Serverul marchează mutarea (moved_by_business_at); clientul o confirmă
 * prin ack_moved_appointment (moved_seen_at). Bannerul apare doar între cele două.
 */
export function needsMovedAck(a: {
  moved_by_business_at?: string | null;
  moved_seen_at?: string | null;
}): boolean {
  return Boolean(a.moved_by_business_at) && !a.moved_seen_at;
}
