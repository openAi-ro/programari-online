/**
 * Încarcă scripts/twilio.env și setează secrets pe Supabase (Edge Functions).
 *
 * Necesită: supabase login + supabase link --project-ref tucujqpgshrmljkmqvnl
 *
 * Rulează: node scripts/configure-supabase-twilio.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, 'twilio.env');

if (!existsSync(envPath)) {
  console.error('Lipsește scripts/twilio.env — copiază din twilio.env.example și completează.');
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

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET,
  TWILIO_WHATSAPP_FROM,
} = env;

const hasAuthToken = !!TWILIO_AUTH_TOKEN;
const hasApiKey = TWILIO_API_KEY_SID?.startsWith('SK') && !!TWILIO_API_KEY_SECRET;

if (!TWILIO_ACCOUNT_SID || !TWILIO_WHATSAPP_FROM || (!hasAuthToken && !hasApiKey)) {
  console.error(
    'twilio.env incomplet: TWILIO_ACCOUNT_SID, TWILIO_WHATSAPP_FROM + (TWILIO_AUTH_TOKEN sau TWILIO_API_KEY_SID/SECRET)'
  );
  process.exit(1);
}

const secrets = [
  ['WHATSAPP_PROVIDER', 'twilio'],
  ['TWILIO_ACCOUNT_SID', TWILIO_ACCOUNT_SID],
  ['TWILIO_WHATSAPP_FROM', TWILIO_WHATSAPP_FROM],
];

if (hasAuthToken) secrets.push(['TWILIO_AUTH_TOKEN', TWILIO_AUTH_TOKEN]);
if (hasApiKey) {
  secrets.push(['TWILIO_API_KEY_SID', TWILIO_API_KEY_SID]);
  secrets.push(['TWILIO_API_KEY_SECRET', TWILIO_API_KEY_SECRET]);
}

console.log('Setez secrets Twilio pe Supabase...\n');

for (const [key, value] of secrets) {
  const r = spawnSync('supabase', ['secrets', 'set', `${key}=${value}`], {
    stdio: 'inherit',
    shell: true,
    cwd: join(__dir, '..'),
  });
  if (r.status !== 0) {
    console.error(`\nEroare la ${key}. Rulează: supabase login && supabase link --project-ref tucujqpgshrmljkmqvnl`);
    process.exit(1);
  }
  console.log(`  ✓ ${key}`);
}

console.log('\nDeploy funcții WhatsApp...');
for (const fn of ['test-whatsapp', 'auth-whatsapp-otp', 'auth-whatsapp-verify']) {
  const extra = fn.startsWith('auth-') ? ['--no-verify-jwt'] : [];
  const deploy = spawnSync(
    'supabase',
    ['functions', 'deploy', fn, ...extra],
    { stdio: 'inherit', shell: true, cwd: join(__dir, '..') }
  );
  if (deploy.status !== 0) {
    console.warn(`Deploy ${fn} eșuat — rulează manual după login.`);
  }
}

for (const fn of ['notify-decision', 'send-reminders']) {
  spawnSync('supabase', ['functions', 'deploy', fn], {
    stdio: 'inherit',
    shell: true,
    cwd: join(__dir, '..'),
  });
}

console.log(`
Gata! Testează:
  1. node scripts/test-twilio-whatsapp.mjs   (mesaj direct Twilio)
  2. App → Setări → telefon 0769360100 → Trimite mesaj test WhatsApp
`);
