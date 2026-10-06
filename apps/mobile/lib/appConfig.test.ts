// @ts-nocheck — test rulat cu tsx (node); repo-ul n-are @types/node.
/**
 * Run: npx tsx lib/appConfig.test.ts
 * from apps/mobile
 *
 * Regresie: react-native-maps 1.27 își injectează cheia nativă DOAR din
 * props-urile pluginului (androidGoogleMapsApiKey / iosGoogleMapsApiKey).
 * android.config.googleMaps.apiKey e ignorat (fallback-ul legacy Expo nu
 * rulează când pachetul își aduce plugin propriu). Fără props, MapView
 * nativ crapă cu "API key not found" și aplicația se închide.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

type PluginEntry = string | [string, Record<string, unknown>];
type AppJson = {
  expo: {
    plugins?: PluginEntry[];
    android?: { config?: { googleMaps?: { apiKey?: string } } };
    ios?: { config?: { googleMapsApiKey?: string } };
  };
};

const here = dirname(fileURLToPath(import.meta.url));
const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8')) as AppJson;
const plugins = appJson.expo.plugins ?? [];
const maps = plugins.find((p) => (typeof p === 'string' ? p : p[0]) === 'react-native-maps');

assert(maps !== undefined, 'react-native-maps e în plugins');
assert(
  typeof maps !== 'string' &&
    typeof maps?.[1]?.androidGoogleMapsApiKey === 'string' &&
    (maps[1].androidGoogleMapsApiKey as string).length > 10,
  'pluginul maps are androidGoogleMapsApiKey'
);
assert(
  typeof maps !== 'string' &&
    typeof maps?.[1]?.iosGoogleMapsApiKey === 'string' &&
    (maps[1].iosGoogleMapsApiKey as string).length > 10,
  'pluginul maps are iosGoogleMapsApiKey'
);
assert(
  typeof maps !== 'string' &&
    maps?.[1]?.androidGoogleMapsApiKey ===
      appJson.expo.android?.config?.googleMaps?.apiKey,
  'cheia android din plugin = cea din android.config'
);
assert(
  typeof maps !== 'string' &&
    maps?.[1]?.iosGoogleMapsApiKey === appJson.expo.ios?.config?.googleMapsApiKey,
  'cheia iOS din plugin = cea din ios.config'
);

console.log(`appConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
