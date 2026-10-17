export const MAX_INTAKE_TEXT = 500;

export type ClientPhotoKind = 'before' | 'after';

/** Text de fișă: fără spații marginale, maxim 500 caractere. */
export function normalizeIntakeText(value: string | null | undefined): string {
  return (value ?? '').trim().slice(0, MAX_INTAKE_TEXT);
}

export function photoKindLabel(kind: string): ClientPhotoKind {
  return kind === 'after' ? 'after' : 'before';
}
