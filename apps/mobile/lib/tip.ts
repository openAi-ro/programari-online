export type TipOption = { percent: number; amount: number };

export const TIP_PERCENTS = [0, 5, 10, 15];

/** Opțiuni de bacșiș din prețul serviciului, rotunjite la 2 zecimale. */
export function tipOptions(servicePrice: number): TipOption[] {
  const base = Number.isFinite(servicePrice) && servicePrice > 0 ? servicePrice : 0;
  return TIP_PERCENTS.map((percent) => ({
    percent,
    amount: Math.round(base * (percent / 100) * 100) / 100,
  }));
}

/** Sumă liberă de bacșiș: gol → 0, altfel număr între 0 și prețul serviciului. */
export function parseTipInput(raw: string, servicePrice: number): number | null {
  const clean = (raw ?? '').trim().replace(',', '.');
  if (clean === '') return 0;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value > servicePrice) return null;
  return Math.round(value * 100) / 100;
}
