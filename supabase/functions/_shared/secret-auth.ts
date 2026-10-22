/**
 * Shared-secret checks for server-to-server calls (pg_cron jobs, DB webhooks).
 * Fail-closed: if the secret is not configured the function refuses to run (500)
 * instead of silently skipping verification.
 */

export type AuthResult = { ok: true } | { ok: false; status: number; error: string };

/** Constant-time string comparison. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i]! ^ eb[i]!;
  return diff === 0;
}

export function bearerToken(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

/** Exact match with this project's service-role key (server callers only). */
export function isServiceRole(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return !!serviceKey && safeEqual(bearerToken(req), serviceKey);
}

/** pg_cron callers: x-cron-secret header (from Vault `cron_secret`) or service-role bearer. */
export function authorizeCron(req: Request): AuthResult {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) {
    console.error('CRON_SECRET not configured');
    return { ok: false, status: 500, error: 'server_misconfigured' };
  }
  if (safeEqual(req.headers.get('x-cron-secret'), secret) || isServiceRole(req)) return { ok: true };
  return { ok: false, status: 401, error: 'unauthorized' };
}

/**
 * DB webhook callers: x-webhook-secret header (from Vault `webhook_secret`).
 * Returns 'missing' when WEBHOOK_SECRET is not configured so callers fail closed.
 */
export function checkWebhookSecret(req: Request): 'ok' | 'missing' | 'no_match' {
  const secret = Deno.env.get('WEBHOOK_SECRET');
  if (!secret) {
    console.error('WEBHOOK_SECRET not configured');
    return 'missing';
  }
  return safeEqual(req.headers.get('x-webhook-secret'), secret) ? 'ok' : 'no_match';
}
