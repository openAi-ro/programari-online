// Programari media Worker (Cloudflare R2).
//   GET/HEAD /m/<bucket>/<folder>/<file>        public presentation media (cache + Range)
//   PUT/DELETE /m/<bucket>/<folder>/<file>      owner upload/delete (Supabase JWT, media_can_write)
//   PUT /c/<conversationId>/<file>              chat attachment upload (JWT, chat_can_access)
//   POST /c-sign {keys:[...]}                   short-lived signed read URLs for chat files
//   GET/HEAD /c/<conversationId>/<file>?exp&sig signed private read (Range)
// Authorization runs inside Postgres with the caller's own JWT + apikey headers,
// so this Worker stores no Supabase key. SIGNING_KEY is a Worker secret.

const MB = 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

const PUBLIC_BUCKETS = {
  'profile-avatars': { types: IMAGE_TYPES, maxBytes: 5 * MB },
  'business-logos': { types: IMAGE_TYPES, maxBytes: 5 * MB },
  'business-media': { types: IMAGE_TYPES, maxBytes: 5 * MB },
  'staff-photos': { types: IMAGE_TYPES, maxBytes: 5 * MB },
  'business-videos': { types: VIDEO_TYPES, maxBytes: 50 * MB },
};
const CHAT_LIMITS = { image: 10 * MB, video: 50 * MB };
const SIGNED_URL_TTL_SECONDS = 3600;

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, range, if-none-match',
  'Access-Control-Expose-Headers': 'content-range, content-length, accept-ranges, etag',
  'Access-Control-Max-Age': '86400',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function splitKey(path) {
  const parts = path.split('/').map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return '';
    }
  });
  return parts.every((p) => SEGMENT.test(p) && !p.includes('..')) ? parts : null;
}

async function rpc(env, request, fn, args) {
  const auth = request.headers.get('authorization') || '';
  const apikey = request.headers.get('apikey') || '';
  if (!/^Bearer\s+\S+/.test(auth) || !apikey) return false;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { Authorization: auth, apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

function checkUpload(request, types, maxBytes) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!types.includes(type)) return { error: json(415, { error: 'unsupported_type' }) };
  const len = Number(request.headers.get('content-length'));
  if (!Number.isFinite(len) || len <= 0) return { error: json(411, { error: 'length_required' }) };
  if (len > maxBytes) return { error: json(413, { error: 'too_large', maxBytes }) };
  return { type, len };
}

async function serveObject(bucket, key, request, cacheControl) {
  const object = await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  if (object === null) return json(404, { error: 'not_found' });
  const headers = new Headers(CORS);
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  let status = 200;
  const range = object.range;
  if (request.headers.has('range') && range) {
    let start;
    let end;
    if (range.suffix != null) {
      start = object.size - range.suffix;
      end = object.size - 1;
    } else {
      start = range.offset ?? 0;
      end = range.length != null ? start + range.length - 1 : object.size - 1;
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
    headers.set('Content-Length', String(end - start + 1));
    status = 206;
  } else {
    headers.set('Content-Length', String(object.size));
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}

async function hmac(env, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handlePublic(request, env, parts) {
  const [bucketName, folder] = parts;
  const rules = PUBLIC_BUCKETS[bucketName];
  if (!rules || parts.length < 2) return json(404, { error: 'not_found' });
  const key = parts.join('/');
  if (request.method === 'GET' || request.method === 'HEAD') {
    // Keys are unique per upload (timestamped), so they can be cached for a long time.
    return serveObject(env.PUBLIC_MEDIA, key, request, 'public, max-age=31536000, immutable');
  }
  if (request.method !== 'PUT' && request.method !== 'DELETE') return json(405, { error: 'method' });
  if (parts.length !== 3) return json(400, { error: 'bad_key' });
  if (!(await rpc(env, request, 'media_can_write', { p_bucket: bucketName, p_folder: folder }))) {
    return json(403, { error: 'forbidden' });
  }
  if (request.method === 'DELETE') {
    await env.PUBLIC_MEDIA.delete(key);
    return json(200, { ok: true });
  }
  const check = checkUpload(request, rules.types, rules.maxBytes);
  if (check.error) return check.error;
  await env.PUBLIC_MEDIA.put(key, request.body, { httpMetadata: { contentType: check.type } });
  return json(200, { key, url: `${new URL(request.url).origin}/m/${key}` });
}

async function handleChat(request, env, parts) {
  if (parts.length !== 2 || !UUID.test(parts[0])) return json(400, { error: 'bad_key' });
  const key = parts.join('/');
  const url = new URL(request.url);
  if (request.method === 'GET' || request.method === 'HEAD') {
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig') || '';
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return json(403, { error: 'expired' });
    if (!safeEqual(sig, await hmac(env, `${key}:${exp}`))) return json(403, { error: 'bad_signature' });
    return serveObject(env.CHAT_FILES, key, request, 'private, max-age=3000');
  }
  if (request.method !== 'PUT') return json(405, { error: 'method' });
  if (!(await rpc(env, request, 'chat_can_access', { p_conversation: parts[0] }))) {
    return json(403, { error: 'forbidden' });
  }
  const type = (request.headers.get('content-type') || '').toLowerCase();
  const kind = type.startsWith('video/') ? 'video' : 'image';
  const check = checkUpload(request, kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES, CHAT_LIMITS[kind]);
  if (check.error) return check.error;
  await env.CHAT_FILES.put(key, request.body, { httpMetadata: { contentType: check.type } });
  return json(200, { key, kind, mime: check.type, bytes: check.len });
}

async function handleSign(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method' });
  const body = await request.json().catch(() => null);
  const keys = Array.isArray(body?.keys) ? body.keys.slice(0, 100) : [];
  const allowed = new Map();
  const urls = {};
  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const origin = new URL(request.url).origin;
  for (const key of keys) {
    const parts = typeof key === 'string' ? splitKey(key) : null;
    if (!parts || parts.length !== 2 || !UUID.test(parts[0])) continue;
    if (!allowed.has(parts[0])) {
      if (allowed.size >= 10) break;
      allowed.set(parts[0], await rpc(env, request, 'chat_can_access', { p_conversation: parts[0] }));
    }
    if (!allowed.get(parts[0])) continue;
    urls[key] = `${origin}/c/${key}?exp=${exp}&sig=${await hmac(env, `${key}:${exp}`)}`;
  }
  return json(200, { urls, exp });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/c-sign') return handleSign(request, env);
    const match = url.pathname.match(/^\/(m|c)\/(.+)$/);
    if (!match) return json(404, { error: 'not_found' });
    const parts = splitKey(match[2]);
    if (!parts) return json(400, { error: 'bad_key' });
    return match[1] === 'm' ? handlePublic(request, env, parts) : handleChat(request, env, parts);
  },
};
