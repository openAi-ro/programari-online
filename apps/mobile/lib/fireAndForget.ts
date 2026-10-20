/**
 * Notificările (push/email/WhatsApp) pleacă în fundal: UI-ul nu le mai așteaptă
 * (edge function-urile durează 1–4 s). Eșecul doar se loghează, ca înainte.
 */
export function fireAndForget(
  task: Promise<{ ok: boolean; error?: string }>,
  label: string,
  warn: (...args: unknown[]) => void = console.warn
): void {
  task
    .then((r) => {
      if (!r.ok) warn(label, r.error);
    })
    .catch((e: unknown) => warn(label, e instanceof Error ? e.message : e));
}
