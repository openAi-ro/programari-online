/**
 * Pure helpers for the Meta WhatsApp Cloud API webhook (unit-tested).
 */

/** Constant-time compare of two strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Verify X-Hub-Signature-256: "sha256=<hex hmac of raw body with app secret>". */
export async function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string
): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return safeEqual(hex, header.slice('sha256='.length).toLowerCase());
}

export type WaStatusUpdate = {
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: string | null;
  errorMessage: string | null;
};

type MetaStatus = {
  id?: string;
  status?: string;
  errors?: { code?: number | string; title?: string; message?: string; error_data?: { details?: string } }[];
};

/** Extract message status updates from a webhook payload (ignores inbound messages). */
export function extractStatuses(payload: unknown): WaStatusUpdate[] {
  const out: WaStatusUpdate[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry ?? [];
  for (const entry of entries as { changes?: { value?: { statuses?: MetaStatus[] } }[] }[]) {
    for (const ch of entry?.changes ?? []) {
      for (const st of ch?.value?.statuses ?? []) {
        if (!st?.id || !st.status) continue;
        if (!['sent', 'delivered', 'read', 'failed'].includes(st.status)) continue;
        const err = st.errors?.[0];
        out.push({
          wamid: st.id,
          status: st.status as WaStatusUpdate['status'],
          errorCode: err?.code != null ? String(err.code) : null,
          errorMessage: err
            ? [err.title ?? err.message, err.error_data?.details].filter(Boolean).join(' — ').slice(0, 500) ||
              null
            : null,
        });
      }
    }
  }
  return out;
}

const RANK: Record<string, number> = {
  stub: 0,
  invalid_phone: 0,
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
};

/** Webhooks can arrive out of order: never downgrade read -> delivered. failed always wins. */
export function shouldApplyStatus(current: string | null | undefined, next: string): boolean {
  if (next === 'failed') return true;
  if (current === 'failed') return false;
  return (RANK[next] ?? 0) > (RANK[current ?? ''] ?? 0);
}
