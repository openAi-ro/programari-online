/**
 * „Butonul tău de programare”: codurile HTML pe care firma le pune pe site-ul ei.
 * Pur (fără importuri native) — linkul vine din getBookingPaths(...).webUrl,
 * adică din singura bază publică (lib/webBase.ts).
 */

/** Parametrul care pune pagina publică în modul iframe. */
export const EMBED_QUERY = 'embed=1&lang=ro';

export function isEmbedParam(value: string | string[] | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v === '1' || v === 'true';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Linkul paginii publice în modul iframe (română, fără bara fixă de jos). */
export function embedUrl(webUrl: string): string {
  return `${webUrl}${webUrl.includes('?') ? '&' : '?'}${EMBED_QUERY}`;
}

/** Buton-link stilizat „Programează-te online”, deschis în tab nou. */
export function buttonSnippet(webUrl: string): string {
  const style = [
    'display:inline-block',
    'padding:12px 22px',
    'background:#111827',
    'color:#ffffff',
    'border-radius:10px',
    'font:600 16px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    'text-decoration:none',
  ].join(';');
  return `<a href="${escapeHtml(webUrl)}" target="_blank" rel="noopener" style="${style}">Programează-te online</a>`;
}

/** Programarea direct în pagina site-ului (iframe). */
export function iframeSnippet(webUrl: string, businessName: string): string {
  const title = escapeHtml(`Programare online${businessName.trim() ? ` – ${businessName.trim()}` : ''}`);
  return `<iframe src="${escapeHtml(embedUrl(webUrl))}" title="${title}" width="100%" height="900" style="border:0;width:100%;max-width:720px" loading="lazy"></iframe>`;
}
