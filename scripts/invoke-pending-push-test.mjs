/**
 * Re-fire notify-pending-push for an existing appointment (e.g. SQL-inserted).
 *
 * Usage (from repo root, with service role):
 *   node scripts/invoke-pending-push-test.mjs
 *
 * Env (apps/mobile/.env or process env):
 *   EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (preferred)
 *   or EXPO_PUBLIC_SUPABASE_ANON_KEY (if function allows JWT/anon)
 *
 * Override ids:
 *   APPOINTMENT_ID=... BUSINESS_ID=... node scripts/invoke-pending-push-test.mjs
 *
 * After deploy:
 *   npx supabase functions deploy notify-pending-push --no-verify-jwt
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^\uFEFF/, '');
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(resolve('apps/mobile/.env'));
loadEnvFile(resolve('scripts/twilio.env'));

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

const appointmentId =
  process.env.APPOINTMENT_ID || '8f2fce29-c1ea-46bf-8c67-faa7f0a75bf2';
const businessId =
  process.env.BUSINESS_ID || '0e1d5765-4741-4685-97aa-50bb2ded3f59';

if (!url || !key) {
  console.error('Missing SUPABASE URL or key in env / apps/mobile/.env');
  process.exit(1);
}

const endpoint = `${url.replace(/\/$/, '')}/functions/v1/notify-pending-push`;
const body = {
  id: appointmentId,
  business_id: businessId,
  status: 'pending',
};

console.log('POST', endpoint);
console.log('body', body);

const res = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    apikey: key,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log('status', res.status);
console.log(text);

if (!res.ok) process.exit(1);
