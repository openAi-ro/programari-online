// Nomenclator județe + localități pentru adrese structurate.
// Datele vin din assets/data/ro-localitati.json, generate din nomenclatorul oficial.
// Aceeași logică de potrivire ca în romania_geo.py, dar fără dependență de Python.

import localitatiData from '@/assets/data/ro-localitati.json';
import { trKey } from './i18n';

type JudetEntry = { auto: string; nume: string; localitati: string[] };

const JUDETE_DATA = (localitatiData as { judete: JudetEntry[] }).judete;

const PREFIX_LOCALITATE = /^(municipiul|municipiu|orasul|oras|comuna|satul|sat) /;
const PREFIX_JUDET = /^(municipiul|municipiu|judetul|judet|jud) /;

/**
 * Normalizează pentru comparare: fără diacritice, fără semne, case-insensitive.
 * NFKD descompune și `ș`/`ț` cu virgulă, și `ş`/`ţ` cu sedilă, deci ambele variante
 * întâlnite în date se compară corect.
 */
export function normalizeRo(text: string | null | undefined): string {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const JUDETE: string[] = JUDETE_DATA.map((j) => j.nume);

function gasesteJudet(input: string | null | undefined): JudetEntry | null {
  const key = normalizeRo(input);
  if (!key) return null;

  // Cod auto (ex. „CJ”, „B”) — util când vine din reverse geocoding.
  if (key.length <= 3) {
    const byAuto = JUDETE_DATA.find((j) => normalizeRo(j.auto) === key);
    if (byAuto) return byAuto;
  }

  const exact = JUDETE_DATA.find((j) => normalizeRo(j.nume) === key);
  if (exact) return exact;

  const stripped = key.replace(PREFIX_JUDET, '');
  if (!stripped) return null;

  return (
    JUDETE_DATA.find((j) => normalizeRo(j.nume) === stripped) ??
    JUDETE_DATA.find((j) => normalizeRo(j.nume).startsWith(stripped)) ??
    null
  );
}

/** Numele canonic al județului, sau '' dacă nu e în nomenclator. */
export function judetCanonic(input: string | null | undefined): string {
  return gasesteJudet(input)?.nume ?? '';
}

export function localitatiPentruJudet(judet: string): string[] {
  return gasesteJudet(judet)?.localitati ?? [];
}

/** Numele canonic al localității din județul dat, sau '' dacă nu există. */
export function localitateCanonica(judet: string, input: string | null | undefined): string {
  const j = gasesteJudet(judet);
  const key = normalizeRo(input);
  if (!j || !key) return '';

  const exact = j.localitati.find((l) => normalizeRo(l) === key);
  if (exact) return exact;

  const stripped = key.replace(PREFIX_LOCALITATE, '');
  if (!stripped) return '';

  return (
    j.localitati.find((l) => normalizeRo(l) === stripped) ??
    j.localitati.find((l) => normalizeRo(l).startsWith(stripped)) ??
    ''
  );
}

/**
 * Județul în care se află localitatea dată, sau '' dacă nu se găsește.
 * Folosit la completarea adreselor vechi, care aveau doar orașul.
 */
export function judetPentruLocalitate(input: string | null | undefined): string {
  const key = normalizeRo(input);
  if (!key) return '';

  // „București” nu apare ca localitate în nomenclator — acolo sunt doar sectoarele.
  if (key.startsWith('bucuresti')) return judetCanonic('B');

  const candidates = [key];
  const stripped = key.replace(PREFIX_LOCALITATE, '');
  if (stripped && stripped !== key) candidates.push(stripped);

  for (const candidate of candidates) {
    const found = JUDETE_DATA.find((j) =>
      j.localitati.some((l) => normalizeRo(l) === candidate)
    );
    if (found) return found.nume;
  }
  return '';
}

/** Adresa pe o linie: „Jud. Cluj, Cluj-Napoca, Strada Memorandumului 12”. */
export function adresaCompleta(
  judet: string | null | undefined,
  localitate: string | null | undefined,
  strada: string | null | undefined
): string {
  const parts: string[] = [];
  const j = (judet ?? '').trim();
  const l = (localitate ?? '').trim();
  const s = (strada ?? '').trim();
  if (j) parts.push(trKey('loc.countyPrefix', { county: j }));
  if (l) parts.push(l);
  if (s) parts.push(s);
  return parts.join(', ');
}