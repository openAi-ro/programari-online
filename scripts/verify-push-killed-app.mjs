/**
 * Verificare cap-coadă pentru popup remote (app business ÎNCHISĂ complet).
 *
 * Ce verifică (tot ce se poate automatiza de pe PC):
 *  1) google-services.json există + package-ul corespunde cu app.json
 *  2) app.json: plugin expo-notifications, defaultChannel, permisiuni, projectId EAS
 *  3) Edge Function notify-pending-push e deployată și răspunde
 *  4) device_push_tokens: câte token-uri are business-ul în DB
 *
 * Ce NU se poate verifica de pe PC (afișează checklist):
 *  - webhook Database → INSERT appointments → notify-pending-push (Dashboard)
 *  - cheia FCM V1 încărcată în EAS credentials
 *  - „Pop on screen” activat pe telefon (Setări → Verifică status push)
 *
 * Usage (din rădăcina repo):
 *   node scripts/verify-push-killed-app.mjs
 *   OWNER_USER_ID=<uuid> node scripts/verify-push-killed-app.mjs
 *
 * Env (apps/mobile/.env sau process env):
 *   EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (necesar pentru pasul 3–4)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobileDir = resolve(root, 'apps/mobile');

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

loadEnvFile(resolve(mobileDir, '.env'));

let failures = 0;
function ok(msg) {
  console.log(`[OK] ${msg}`);
}
function fail(msg) {
  failures += 1;
  console.log(`[LIPSA/EROARE] ${msg}`);
}
function info(msg) {
  console.log(`       ${msg}`);
}

// --- 1) google-services.json + package ---
const gsPath = resolve(mobileDir, 'google-services.json');
const appJsonPath = resolve(mobileDir, 'app.json');
let appJson = null;
try {
  appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  ok('app.json citit');
} catch (e) {
  fail(`nu pot citi app.json: ${e.message}`);
}
const pkg = appJson?.expo?.android?.package ?? null;

if (!existsSync(gsPath)) {
  fail('google-services.json lipsește din apps/mobile/');
  info('Rulează: npm run setup:push (sau scripts/setup-push-android.ps1)');
} else {
  try {
    const gs = JSON.parse(readFileSync(gsPath, 'utf8'));
    const pkgs = (Array.isArray(gs.client) ? gs.client : [])
      .map((c) => c?.client_info?.android_client_info?.package_name)
      .filter(Boolean);
    if (pkg && pkgs.includes(pkg)) {
      ok(`google-services.json conține package-ul ${pkg}`);
    } else {
      fail(`package-ul ${pkg} nu apare în google-services.json (găsite: ${pkgs.join(', ') || 'nimic'})`);
    }
  } catch (e) {
    fail(`google-services.json invalid: ${e.message}`);
  }
}
if (appJson?.expo?.android?.googleServicesFile) {
  ok(`app.json android.googleServicesFile = ${appJson.expo.android.googleServicesFile}`);
} else {
  fail('app.json nu are android.googleServicesFile — push FCM nu merge în APK');
}

// --- 2) plugin expo-notifications + permissions + projectId ---
const plugins = appJson?.expo?.plugins ?? [];
const notifPlugin = plugins.find(
  (p) => p === 'expo-notifications' || (Array.isArray(p) && p[0] === 'expo-notifications')
);
if (!notifPlugin) {
  fail('lipsește plugin-ul expo-notifications din app.json');
} else {
  const opts = Array.isArray(notifPlugin) ? notifPlugin[1] ?? {} : {};
  if (opts.defaultChannel === 'cereri_heads') {
    ok('defaultChannel = cereri_heads (canalul popup)');
  } else {
    fail(`defaultChannel e „${opts.defaultChannel ?? 'nesetat'}”, trebuie „cereri_heads”`);
  }
}
const perms = appJson?.expo?.android?.permissions ?? [];
for (const p of ['android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE']) {
  if (perms.includes(p)) ok(`permisiune Android: ${p}`);
  else fail(`lipsește permisiunea Android: ${p}`);
}
const projectId = appJson?.expo?.extra?.eas?.projectId ?? null;
if (projectId) ok(`EAS projectId prezent (${projectId})`);
else fail('lipsește extra.eas.projectId — token-ul Expo push nu se poate obține');

// --- 2b) iOS ---
const ios = appJson?.expo?.ios ?? {};
if (ios.bundleIdentifier === 'com.programari.app') {
  ok('ios.bundleIdentifier = com.programari.app');
} else {
  fail(`ios.bundleIdentifier e „${ios.bundleIdentifier ?? 'lipsă'}”, trebuie „com.programari.app”`);
}
if (ios.buildNumber) ok(`ios.buildNumber = ${ios.buildNumber}`);
else fail('lipsește ios.buildNumber din app.json (obligatoriu pentru build iOS)');
if (ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false) {
  ok('ITSAppUsesNonExemptEncryption = false (fără blocaj la submit)');
} else {
  fail('lipsește infoPlist.ITSAppUsesNonExemptEncryption=false (cere confirmare la fiecare submit)');
}
try {
  const eas = JSON.parse(readFileSync(resolve(mobileDir, 'eas.json'), 'utf8'));
  for (const p of ['development', 'preview', 'production']) {
    if (eas?.build?.[p]?.ios) ok(`eas.json build.${p}.ios prezent`);
    else fail(`lipsește eas.json build.${p}.ios`);
  }
  const asc = eas?.submit?.production?.ios?.ascAppId;
  if (asc && !String(asc).includes('INLOCUIESTE')) ok('ascAppId configurat pentru submit iOS');
  else info('ascAppId încă e placeholder — completează-l după ce creezi app-ul în App Store Connect.');
} catch (e) {
  fail(`nu pot citi eas.json: ${e.message}`);
}
const iosInstall =
  process.env.EXPO_PUBLIC_IOS_INSTALL_URL ||
  appJson?.expo?.extra?.iosInstallUrl ||
  null;
if (iosInstall) ok(`link instalare iOS configurat (${iosInstall.slice(0, 60)}…)`);
else info('link instalare iOS (TestFlight/.ipa) încă lipsește — QR-ul pe iPhone duce la linkul Android.');

// --- 3) + 4) Supabase: function + tokens (necesită service role) ---
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.OWNER_USER_ID || null;

if (!url) {
  fail('lipsește EXPO_PUBLIC_SUPABASE_URL (apps/mobile/.env)');
} else {
  ok(`Supabase URL: ${url}`);
}
if (!serviceKey) {
  info('SKIP pașii 3–4: setează SUPABASE_SERVICE_ROLE_KEY în env pentru verificare server.');
} else {
  // 3) function deployată?
  try {
    const endpoint = `${url.replace(/\/$/, '')}/functions/v1/notify-pending-push`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    if (text.includes('invalid_json') || text.includes('missing_record')) {
      ok('notify-pending-push e deployată și răspunde (auth OK)');
    } else {
      fail(`notify-pending-push răspunde neașteptat: HTTP ${res.status} ${text.slice(0, 160)}`);
      info('Redeploy: supabase functions deploy notify-pending-push');
    }
  } catch (e) {
    fail(`nu pot contacta notify-pending-push: ${e.message}`);
  }

  // 4) token-uri în DB
  try {
    const q = ownerId
      ? `/rest/v1/device_push_tokens?select=user_id,platform,updated_at&user_id=eq.${ownerId}&order=updated_at.desc`
      : `/rest/v1/device_push_tokens?select=user_id,platform,updated_at&order=updated_at.desc&limit=10`;
    const res = await fetch(`${url.replace(/\/$/, '')}${q}`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    if (!res.ok) {
      fail(`nu pot citi device_push_tokens: HTTP ${res.status}`);
    } else {
      const rows = await res.json();
      if (!rows.length) {
        fail('niciun token în device_push_tokens — business-ul NU primește popup cu app-ul închis');
        info('Pe telefon: Setări → Activează / reînregistrează notificările');
      } else {
        ok(`${rows.length} token-uri în device_push_tokens${ownerId ? ' pentru OWNER_USER_ID' : ' (ultimele 10)'}`);
        for (const r of rows.slice(0, 5)) {
          info(`${r.user_id} · ${r.platform} · ${r.updated_at}`);
        }
      }
    }
  } catch (e) {
    fail(`eroare la citirea token-urilor: ${e.message}`);
  }
}

console.log('');
console.log('--- Checklist manual (nu se poate automatiza) ---');
console.log('[ ] Dashboard → Database → Webhooks: INSERT pe appointments → notify-pending-push');
console.log('    Headers: Authorization: Bearer <SERVICE_ROLE>, x-webhook-secret (dacă e setat)');
console.log('[ ] EAS credentials: cheie FCM V1 încărcată (npx eas-cli credentials -p android)');
console.log('[ ] iOS: cheie APNs încărcată (npx eas-cli credentials -p ios) — vezi scripts/setup-push-ios.ps1');
console.log('[ ] APK reconstruit DUPĂ google-services.json + FCM (OTA nu ajunge): npm run build:preview');
console.log('[ ] Pe telefon business: Setări → Verifică status push (toate ✅) + Test popup');
console.log('[ ] Test cap-coadă: închide complet app-ul business → rezervare nouă → popup în bară');
console.log('');
if (failures) {
  console.log(`Rezultat: ${failures} problemă(e) de rezolvat.`);
  process.exit(1);
} else {
  console.log('Rezultat: verificările automate au trecut. Continuă cu checklist-ul manual.');
}
