/**
 * Trimitere Web Push (protocol RFC 8030 + criptare RFC 8291 aes128gcm +
 * semnătură VAPID RFC 8292) fără dependențe externe, pe WebCrypto din Deno.
 * Folosit pentru PWA instalată pe iPhone (iOS-2), alături de Expo Push.
 */

type WebPushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type WebPushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  tag?: string;
};

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  subscription: WebPushSubscriptionRow,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const receiverPublic = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);

  const senderKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const senderPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', senderKeys.publicKey),
  );
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: receiverKey },
      senderKeys.privateKey,
      256,
    ),
  );

  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    receiverPublic,
    senderPublicRaw,
  );
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(
    salt,
    ikm,
    new TextEncoder().encode('Content-Encoding: aes128gcm\0'),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    new TextEncoder().encode('Content-Encoding: nonce\0'),
    12,
  );

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ]);
  // Un singur record: plaintext + delimitator 0x02 (ultimul record).
  const record = concatBytes(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, record as BufferSource),
  );

  const header = new Uint8Array(16 + 4 + 1 + senderPublicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPublicRaw.length;
  header.set(senderPublicRaw, 21);
  return concatBytes(header, ciphertext);
}

async function vapidAuthorization(
  endpoint: string,
  publicKeyB64: string,
  privateKeyB64: string,
  subject: string,
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  };
  const encodeJson = (value: unknown) =>
    bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encodeJson(header)}.${encodeJson(payload)}`;

  const publicBytes = base64UrlToBytes(publicKeyB64);
  const privateBytes = base64UrlToBytes(privateKeyB64);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToBase64Url(publicBytes.slice(1, 33)),
    y: bytesToBase64Url(publicBytes.slice(33, 65)),
    d: bytesToBase64Url(privateBytes),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(unsigned) as BufferSource,
    ),
  );
  const jwt = `${unsigned}.${bytesToBase64Url(signature)}`;
  return `vapid t=${jwt}, k=${publicKeyB64}`;
}

export type WebPushSendResult = {
  sent: number;
  goneEndpoints: string[];
  reason: string | null;
};

/**
 * Trimite payload-ul la toate abonamentele utilizatorului.
 * Returnează endpoint-urile expirate (404/410) ca să fie șterse din tabel.
 * Fără chei VAPID pe server, întoarce reason 'vapid_missing' fără eroare.
 */
export async function sendWebPushToUser(
  // deno-lint-ignore no-explicit-any
  admin: { from: (table: string) => any },
  userId: string,
  payload: WebPushPayload,
): Promise<WebPushSendResult> {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')?.trim();
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')?.trim();
  const subject = Deno.env.get('VAPID_SUBJECT')?.trim() || 'mailto:admin@programari.app';
  if (!publicKey || !privateKey) return { sent: 0, goneEndpoints: [], reason: 'vapid_missing' };

  const { data, error } = await admin
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error) return { sent: 0, goneEndpoints: [], reason: 'subscriptions_failed' };
  const subscriptions = (data ?? []) as WebPushSubscriptionRow[];
  if (!subscriptions.length) return { sent: 0, goneEndpoints: [], reason: 'no_subscriptions' };

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  let sent = 0;
  const goneEndpoints: string[] = [];

  for (const subscription of subscriptions) {
    try {
      const body = await encryptPayload(subscription, plaintext);
      const authorization = await vapidAuthorization(
        subscription.endpoint,
        publicKey,
        privateKey,
        subject,
      );
      const res = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'high',
          Topic: (payload.tag ?? 'programari').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32),
        },
        body: body as BodyInit,
      });
      if (res.status === 404 || res.status === 410) {
        goneEndpoints.push(subscription.endpoint);
      } else if (res.ok) {
        sent += 1;
      } else {
        console.error('Web push rejected', res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      console.error('Web push send failed', e);
    }
  }

  if (goneEndpoints.length) {
    await admin.from('web_push_subscriptions').delete().in('endpoint', goneEndpoints);
  }
  return { sent, goneEndpoints, reason: sent ? null : 'web_push_failed' };
}
