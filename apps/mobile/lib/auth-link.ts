let pendingAuthUrl: string | null = null;

export function stashAuthCallbackUrl(url: string) {
  pendingAuthUrl = url;
}

export function takeAuthCallbackUrl(): string | null {
  const url = pendingAuthUrl;
  pendingAuthUrl = null;
  return url;
}
