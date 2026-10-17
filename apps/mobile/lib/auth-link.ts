let pendingAuthUrl: string | null = null;

export function stashAuthCallbackUrl(url: string) {
  pendingAuthUrl = url;
}

/**
 * URL-ul de procesat pe ecranul de callback. Pe web: adresa din bara (dacă e
 * un callback), altfel deep link-ul. Pe nativ nu există window.location —
 * doar deep link-ul (programari://auth/callback...).
 */
export function pickAuthCallbackUrl(opts: {
  platform: string;
  webHref: string | null;
  linkUrl: string | null;
  isCallback: (url: string) => boolean;
}): string | null {
  if (opts.platform === 'web' && opts.webHref && opts.isCallback(opts.webHref)) {
    return opts.webHref;
  }
  return opts.linkUrl;
}

export function takeAuthCallbackUrl(): string | null {
  const url = pendingAuthUrl;
  pendingAuthUrl = null;
  return url;
}
