/** Validare pura pentru mutarea unei programari pe alt slot (de catre business). */
export function validateMoveInput(opts: {
  slotStartUtc: string | null;
  slotEndUtc: string | null;
  currentStartUtc: string;
  nowIso?: string;
}): string | null {
  if (!opts.slotStartUtc || !opts.slotEndUtc) return 'move_slot_required';
  const now = opts.nowIso ? new Date(opts.nowIso).getTime() : Date.now();
  if (new Date(opts.slotStartUtc).getTime() <= now) return 'move_in_past';
  if (opts.slotStartUtc === opts.currentStartUtc) return 'move_same_slot';
  return null;
}
