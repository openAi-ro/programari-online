/** Maxim poze de portofoliu (lucrări) per specialist. */
export const MAX_PORTFOLIO_PHOTOS = 12;

/** Normalizează lista din DB: fără goluri, duplicate sau spații. */
export function normalizePortfolioUrls(
  urls: readonly string[] | null | undefined,
): string[] {
  if (!urls) return [];
  const out: string[] = [];
  for (const u of urls) {
    const v = typeof u === 'string' ? u.trim() : '';
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_PORTFOLIO_PHOTOS) break;
  }
  return out;
}

export function addPortfolioUrl(urls: readonly string[], url: string): string[] {
  const base = normalizePortfolioUrls(urls);
  const v = url.trim();
  if (!v || base.includes(v) || base.length >= MAX_PORTFOLIO_PHOTOS) return base;
  return [...base, v];
}

export function removePortfolioUrl(urls: readonly string[], url: string): string[] {
  return normalizePortfolioUrls(urls).filter((u) => u !== url);
}
