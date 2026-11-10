/**
 * Mărimea maximă (latura lungă, px) la care micșorăm o poză înainte de upload.
 * Avatar, logo, poză de specialist: 512. Serviciu, copertă, galerie, poze clienți, chat: 1200.
 */
export const IMAGE_MAX_SIDE = { avatar: 512, photo: 1200 } as const;

/** Calitatea de encodare (WebP, sau JPEG unde browserul nu știe WebP). */
export const IMAGE_QUALITY = 0.8;

export type UploadImageType = 'image/webp' | 'image/jpeg' | 'image/png';

/** Dimensiunea după micșorare: latura lungă ≤ maxSide, proporțiile păstrate, nu mărim niciodată. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number
): { width: number; height: number; scaled: boolean } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.max(w, h);
  if (long <= maxSide) return { width: w, height: h, scaled: false };
  const k = maxSide / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), scaled: true };
}

/** Tipul + extensia pentru un MIME de poză; necunoscut → JPEG. */
export function imageTypeOf(mime: string | null | undefined): { contentType: UploadImageType; ext: 'webp' | 'jpg' | 'png' } {
  const m = (mime ?? '').toLowerCase();
  if (m === 'image/webp') return { contentType: 'image/webp', ext: 'webp' };
  if (m === 'image/png') return { contentType: 'image/png', ext: 'png' };
  return { contentType: 'image/jpeg', ext: 'jpg' };
}

/** Tipul după extensia din URI (pe telefon nu avem MIME-ul blob-ului). */
export function imageTypeOfUri(uri: string): ReturnType<typeof imageTypeOf> {
  const ext = (uri.split('?')[0] ?? uri).split('.').pop()?.toLowerCase();
  return imageTypeOf(ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
}

/**
 * Alegem varianta re-encodată doar dacă e utilă: dacă am micșorat poza, sau dacă e mai mică
 * decât originalul. Altfel urcăm originalul (deja mic și comprimat).
 */
export function keepEncoded(opts: { scaled: boolean; encodedBytes: number; sourceBytes: number }): boolean {
  return opts.scaled || opts.encodedBytes < opts.sourceBytes;
}
