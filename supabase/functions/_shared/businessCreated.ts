/**
 * v101 (3.03): programări create de business (business_create_appointment).
 * Pur, fără importuri Deno → testabil cu `npx tsx` (vezi apps/mobile/lib/businessCreated.test.ts).
 */

/** Rândul nou din webhook-ul INSERT: business-ul și-a creat singur programarea → nu-l notificăm. */
export function isBusinessCreatedInsert(
  type: string | undefined,
  record: { created_by?: string | null } | undefined | null,
  reason?: string | null,
): boolean {
  return type === 'INSERT' && !reason && !!record?.created_by;
}

export type ReminderGateRow = {
  client_user_id: string | null;
  created_by?: string | null;
  notify_client?: boolean | null;
  /** client_user_id este owner-ul sau un membru al business-ului (walk-in 3.02 legat greșit). */
  client_is_member?: boolean | null;
};

/**
 * null → trimite ca înainte; altfel motivul pentru care NU trimitem.
 * - creată de business: doar dacă business-ul a bifat „Anunță clientul" (notify_client = true);
 * - walk-in vechi legat de owner/membru: preferințele owner-ului nu sunt ale clientului → nu trimitem.
 */
export function reminderSkipReason(row: ReminderGateRow): 'business_no_notify' | 'member_walkin' | null {
  if (row.client_is_member) return row.notify_client === true ? null : 'member_walkin';
  if (row.created_by) return row.notify_client === true ? null : 'business_no_notify';
  return null;
}
