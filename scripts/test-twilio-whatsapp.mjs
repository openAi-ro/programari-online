/**
 * Test local trimitere WhatsApp via Twilio (fără Supabase).
 *
 * 1. Copiază scripts/twilio.env.example → scripts/twilio.env (NU comite twilio.env!)
 * 2. Completează valorile din Twilio Console
 * 3. Rulează: node scripts/test-twilio-whatsapp.mjs
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

const fileEnv = loadEnvFile(envPath);
const sid = process.env.TWILIO_ACCOUNT_SID ?? fileEnv.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN ?? fileEnv.TWILIO_AUTH_TOKEN;
const apiKeySid = process.env.TWILIO_API_KEY_SID ?? fileEnv.TWILIO_API_KEY_SID;
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET ?? fileEnv.TWILIO_API_KEY_SECRET;
const from = process.env.TWILIO_WHATSAPP_FROM ?? fileEnv.TWILIO_WHATSAPP_FROM;
const to = process.env.TWILIO_WHATSAPP_TO ?? fileEnv.TWILIO_WHATSAPP_TO;

const authUser = apiKeySid?.startsWith('SK') && apiKeySecret ? apiKeySid : sid;
const authPass = apiKeySid?.startsWith('SK') && apiKeySecret ? apiKeySecret : authToken;

if (!sid || !authPass || !from || !to) {
  console.error(`
Lipsesc variabile Twilio.

Copiază scripts/twilio.env.example → scripts/twilio.env și completează:
  TWILIO_ACCOUNT_SID=AC...
  TWILIO_AUTH_TOKEN=...
  TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
  TWILIO_WHATSAPP_TO=whatsapp:+407xxxxxxxx

Înainte: din Twilio Console → Messaging → Try WhatsApp → trimite „join <cod>”
de pe telefonul tău la numărul sandbox.
`);
  process.exit(1);
}

const toWa = to.startsWith('whatsapp:') ? to : `whatsapp:${to.startsWith('+') ? to : '+' + to}`;
const body = new URLSearchParams({
  From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
  To: toWa,
  Body: 'Test Programari: WhatsApp via Twilio funcționează!',
});

console.log('Trimit către', toWa, '...');

const res = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
  {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  }
);

const text = await res.text();
if (!res.ok) {
  console.error('Eroare Twilio', res.status, text);
  if (res.status === 401) {
    console.error('\n→ Rulează mai întâi: node scripts/verify-twilio-credentials.mjs');
  }
  process.exitCode = 1;
} else {
  console.log('OK — verifică WhatsApp pe telefon.');
  console.log(JSON.parse(text).sid ?? text);
}
