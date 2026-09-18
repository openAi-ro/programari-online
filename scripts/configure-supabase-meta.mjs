/**
 * Încarcă scripts/meta.env și setează secrets WhatsApp (Meta) pe Supabase.
 *
 * Necesită: supabase login + supabase link --project-ref tucujqpgshrmljkmqvnl
 *
 * Rulează: node scripts/configure-supabase-meta.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, 'meta.env');

if (!existsSync(envPath)) {
  console.error('Lipsește scripts/meta.env — copiază din meta.env.example și completează tokenul nou.');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

let token = env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
const appId = env.WHATSAPP_APP_ID;
const appSecret = env.WHATSAPP_APP_SECRET;

if (!token || token.startsWith('EAAxxx')) {
  console.error('scripts/meta.env: lipsește WHATSAPP_ACCESS_TOKEN valid (din Meta Business).');
  process.exit(1);
}

if (appId && appSecret) {
  const url = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('fb_exchange_token', token);
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    console.error('Schimbarea în token lung a eșuat. Folosesc tokenul din fișier.');
    console.error(json.error?.message ?? JSON.stringify(json));
  } else {
    token = json.access_token;
    const days = json.expires_in ? Math.round(Number(json.expires_in) / 86400) : null;
    console.log(days ? `Token lung: ~${days} zile.` : 'Token lung obținut.');
  }
}

const secrets = [
  ['WHATSAPP_PROVIDER', 'meta'],
  ['WHATSAPP_ACCESS_TOKEN', token],
];
if (phoneNumberId && !phoneNumberId.startsWith('123456')) {
  secrets.push(['WHATSAPP_PHONE_NUMBER_ID', phoneNumberId]);
}

console.log('Setez secrets Meta pe Supabase...\n');

for (const [key, value] of secrets) {
  const r = spawnSync('npx', ['supabase', 'secrets', 'set', `${key}=${value}`], {
    stdio: 'inherit',
    shell: true,
    cwd: join(__dir, '..'),
  });
  if (r.status !== 0) {
    console.error(`\nEroare la ${key}. Rulează: npx supabase login && npx supabase link --project-ref tucujqpgshrmljkmqvnl`);
    process.exit(1);
  }
  console.log(`  ✓ ${key}`);
}

console.log('\nGata. Nu e nevoie de redeploy. Testează: login cu telefon sau Setări → mesaj test WhatsApp.');
