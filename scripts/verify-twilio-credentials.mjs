/**
 * Verifică credențiale Twilio (fără trimitere mesaj).
 * Rulează: node scripts/verify-twilio-credentials.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, 'twilio.env');

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const out = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnvFile(envPath);
const accountSid = process.env.TWILIO_ACCOUNT_SID ?? env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN ?? env.TWILIO_AUTH_TOKEN;
const apiKeySid = process.env.TWILIO_API_KEY_SID ?? env.TWILIO_API_KEY_SID;
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET ?? env.TWILIO_API_KEY_SECRET;

console.log('\n=== Verificare credențiale Twilio ===\n');

if (!accountSid?.startsWith('AC')) {
  console.error('✗ TWILIO_ACCOUNT_SID invalid — trebuie să înceapă cu AC...');
  console.error('  Dacă ai doar SK..., e API Key SID — vezi twilio.env.example');
  process.exit(1);
}

console.log('Account SID:', accountSid.slice(0, 6) + '...' + accountSid.slice(-4));

let user = authToken;
let pass = authToken;
let mode = 'auth_token';

if (apiKeySid?.startsWith('SK') && apiKeySecret) {
  user = apiKeySid;
  pass = apiKeySecret;
  mode = 'api_key';
  console.log('Mod autentificare: API Key (SK... + Secret)');
} else if (authToken) {
  console.log('Mod autentificare: Account SID + Auth Token');
  if (authToken.length < 20) {
    console.warn('⚠ Auth Token pare prea scurt — verifică să nu fie alt câmp din consolă.');
  }
} else {
  console.error('✗ Lipsește TWILIO_AUTH_TOKEN sau TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`;

const res = await fetch(url, { headers: { Authorization: auth } });
const body = await res.text();

if (res.ok) {
  const data = JSON.parse(body);
  console.log('\n✓ Autentificare OK');
  console.log('  Cont:', data.friendly_name ?? data.sid);
  console.log('  Status:', data.status);
  console.log('\nPoți rula: node scripts/test-twilio-whatsapp.mjs');
  process.exit(0);
}

console.error('\n✗ Autentificare eșuată (401 / 20003)\n');

if (res.status === 401) {
  console.error('Cauze frecvente:');
  console.error('  1. Auth Token greșit — copiază din Console → Account → API keys & tokens');
  console.error('     → „Auth Token” (Show), NU „API Key Secret” decât dacă folosești SK...');
  console.error('  2. Token rotit — dacă ai apăsat Rotate, copiază tokenul NOU');
  console.error('  3. SID și Token din conturi diferite (main vs subaccount)');
  console.error('  4. Spații la copy-paste — șterge linia și lipește din nou în twilio.env');
  console.error('\nUnde găsești valorile corecte:');
  console.error('  https://console.twilio.com → Account Info (pagina principală)');
  console.error('  • Account SID = AC...');
  console.error('  • Auth Token = click Show (32 caractere, litere+cifre)');
}

console.error('\nRăspuns Twilio:', body);
process.exit(1);
