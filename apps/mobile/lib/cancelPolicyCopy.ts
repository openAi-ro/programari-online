import { trKey } from './i18n';

/** Short policy line shown before cancel confirm, in the current language. */
export function cancelPolicyLine(opts?: {
  cancelNoticeMinutes?: number | null;
  paymentStatus?: string | null;
  depositRon?: number | null;
}): string {
  const mins = opts?.cancelNoticeMinutes ?? 0;
  const parts: string[] = [];

  if (mins > 0) {
    if (mins >= 60 && mins % 60 === 0) {
      const h = mins / 60;
      parts.push(
        h === 1
          ? trKey('cancelPolicy.hourOne')
          : trKey('cancelPolicy.hours', { h })
      );
    } else if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      parts.push(trKey('cancelPolicy.hoursMins', { h, m }));
    } else {
      parts.push(trKey('cancelPolicy.minutes', { mins }));
    }
  } else {
    parts.push(trKey('cancelPolicy.instant'));
  }


  return parts.join(' ');
}
