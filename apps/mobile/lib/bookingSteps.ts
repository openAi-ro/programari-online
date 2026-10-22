/** Pașii programării de pe pagina publică, în ordinea afișării. */
export type BookingStep = 'service' | 'date' | 'time';

const ORDER: BookingStep[] = ['service', 'date', 'time'];

/** Numerele pașilor, calculate doar din pașii vizibili (1, 2, 3…). */
export function bookingStepNumbers(
  visible: Record<BookingStep, boolean>
): Partial<Record<BookingStep, number>> {
  const out: Partial<Record<BookingStep, number>> = {};
  let n = 0;
  for (const step of ORDER) {
    if (visible[step]) out[step] = ++n;
  }
  return out;
}