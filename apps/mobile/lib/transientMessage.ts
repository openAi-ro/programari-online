/** Cât timp rămâne vizibil bannerul de succes (ex. „Telefon salvat”). */
export const SUCCESS_MESSAGE_TIMEOUT_MS = 4000;

/**
 * Programează dispariția unui mesaj temporar.
 * Returnează funcția de anulare, pentru cleanup în useEffect.
 */
export function scheduleMessageDismiss(
  onDismiss: () => void,
  ms: number = SUCCESS_MESSAGE_TIMEOUT_MS,
): () => void {
  const timer = setTimeout(onDismiss, ms);
  return () => clearTimeout(timer);
}
