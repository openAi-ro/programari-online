/** Normalizează ce scrie firma: @handle, handle sau URL complet. */
export function normalizeInstagramUrl(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const fromUrl = raw.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/);
  const handle = fromUrl ? fromUrl[1] : raw.replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null;
  return `https://instagram.com/${handle}`;
}

export function normalizeFacebookUrl(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const fromUrl = raw.match(/(?:https?:\/\/)?(?:www\.)?facebook\.com\/([A-Za-z0-9._-]+)/);
  const page = fromUrl ? fromUrl[1] : raw.replace(/^@/, '');
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(page)) return null;
  return `https://facebook.com/${page}`;
}

/** Text de pus în bio pe Instagram/Facebook, cu linkul de rezervare. */
export function buildBioText(businessName: string, bookingUrl: string): string {
  const name = (businessName ?? '').trim();
  return name ? `${name} — programează-te aici: ${bookingUrl}` : bookingUrl;
}
