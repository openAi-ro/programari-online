/**
 * Timing rules for the "soon" reminder (pure, unit-tested in windows.test.ts).
 *
 * An approved appointment with reminder_sent=false gets the soon reminder on the first cron
 * run (every 5 min) where:
 *   - it starts more than SOON_MIN_MIN and at most SOON_MAX_MIN minutes from now, and
 *   - its confirmation went out at least CONFIRM_GRACE_MIN minutes ago.
 * Normal bookings (confirmed long before) are picked 60-65 min before the start -> kind '1h'.
 * Late bookings are picked once the grace period has passed -> kind 'catchup' when the start
 * is less than ONE_HOUR_MIN_MIN away (text names the time, not "in 1 hour").
 * Bookings confirmed less than SOON_MIN_MIN + CONFIRM_GRACE_MIN before the start get no
 * soon reminder (the confirmation itself is recent enough).
 *
 * Keep in sync with the pg_cron prefilter (migration v73_reminder_1h).
 */
export const SOON_MAX_MIN = 65;
export const SOON_MIN_MIN = 15;
export const ONE_HOUR_MIN_MIN = 55;
export const CONFIRM_GRACE_MIN = 20;

const MIN = 60 * 1000;

export type SoonWindow = {
  /** start_at must be strictly after this */
  from: string;
  /** start_at must be at or before this */
  to: string;
  /** confirmation time must be at or before this */
  confirmedBefore: string;
};

export function soonWindow(nowMs: number): SoonWindow {
  return {
    from: new Date(nowMs + SOON_MIN_MIN * MIN).toISOString(),
    to: new Date(nowMs + SOON_MAX_MIN * MIN).toISOString(),
    confirmedBefore: new Date(nowMs - CONFIRM_GRACE_MIN * MIN).toISOString(),
  };
}

/** Same predicate as the SQL in send-reminders (used by tests and as documentation). */
export function isSoonDue(startMs: number, confirmedAtMs: number, nowMs: number): boolean {
  const ahead = startMs - nowMs;
  return (
    ahead > SOON_MIN_MIN * MIN &&
    ahead <= SOON_MAX_MIN * MIN &&
    confirmedAtMs <= nowMs - CONFIRM_GRACE_MIN * MIN
  );
}

export function soonKind(startMs: number, nowMs: number): '1h' | 'catchup' {
  return startMs - nowMs >= ONE_HOUR_MIN_MIN * MIN ? '1h' : 'catchup';
}
