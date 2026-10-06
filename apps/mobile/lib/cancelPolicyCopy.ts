/** Short Romanian line shown before cancel confirm. */
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
          ? 'Anularea e permisă cu cel puțin 1 oră înainte.'
          : `Anularea e permisă cu cel puțin ${h} ore înainte.`
      );
    } else if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      parts.push(`Anularea e permisă cu cel puțin ${h}h ${m}min înainte.`);
    } else {
      parts.push(`Anularea e permisă cu cel puțin ${mins} minute înainte.`);
    }
  } else {
    parts.push('Anularea e definitivă — slotul se eliberează imediat.');
  }


  return parts.join(' ');
}
