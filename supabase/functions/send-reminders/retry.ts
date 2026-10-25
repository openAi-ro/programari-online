/**
 * Retry rules for reminders (pure, unit-tested in retry.test.ts).
 *
 * A reminder is claimed by flipping its flag (reminder_sent / reminder_24h_sent) before
 * sending, so two overlapping cron runs never both send. Delivery per channel is tracked in
 * public.notification_log (appointment_id + type + channel):
 *   - a channel with any row that is not 'failed' (accepted, delivered, read, stub,
 *     invalid_phone) is done and is never sent again -> no duplicates;
 *   - a channel whose rows are all 'failed' is retried until MAX_SEND_ATTEMPTS.
 * When a channel failed and still has attempts left, the flag is released so the next cron
 * run (every 5 min) retries it, but only while the appointment is still inside its window
 * (windows.ts / v73 prefilter); after that the reminder is simply missed.
 */
export const MAX_SEND_ATTEMPTS = 3;

export type Channel = 'email' | 'whatsapp';
export type ChannelLogRow = { channel: string; status: string | null };

type ChannelState = { done: boolean; failedAttempts: number };

function stateOf(channel: Channel, log: ChannelLogRow[]): ChannelState {
  const rows = log.filter((r) => r.channel === channel);
  const failedAttempts = rows.filter((r) => r.status === 'failed').length;
  return { done: rows.length > failedAttempts, failedAttempts };
}

/** Channels to send in this run: not yet delivered and with attempts left. */
export function channelsToSend(planned: Channel[], log: ChannelLogRow[]): Channel[] {
  return planned.filter((c) => {
    const s = stateOf(c, log);
    return !s.done && s.failedAttempts < MAX_SEND_ATTEMPTS;
  });
}

/** Push goes out once, on the first attempt (no earlier log rows for this reminder). */
export function isFirstAttempt(log: ChannelLogRow[]): boolean {
  return log.length === 0;
}

/**
 * After this run: true when a channel sent now failed and may still be retried, i.e. the
 * flag must be released. `failedNow` = channels whose send returned outcome 'failed'.
 */
export function shouldRetry(failedNow: Channel[], log: ChannelLogRow[]): boolean {
  return failedNow.some((c) => stateOf(c, log).failedAttempts + 1 < MAX_SEND_ATTEMPTS);
}

/** Same status as logNotification writes; returns the channels whose send failed now. */
export function failedChannels(
  results: { ok: boolean; stub?: boolean; outcome?: string; channel: Channel }[]
): Channel[] {
  return results
    .filter((r) => (r.outcome ?? (r.ok ? 'accepted' : r.stub ? 'stub' : 'failed')) === 'failed')
    .map((r) => r.channel);
}
