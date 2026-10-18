// @ts-nocheck — test rulat cu tsx (node); repo-ul n-are @types/node.
/**
 * Run: npx tsx lib/appConfig.test.ts
 * from apps/mobile
 *
 * 1) Nu livrăm o cheie Google Maps falsă (placeholder) în app.json.
 * 2) Regresie: react-native-maps 1.27 își injectează cheia nativă DOAR din
 *    props-urile pluginului (androidGoogleMapsApiKey / iosGoogleMapsApiKey).
 *    Când se pune o cheie reală, trebuie pusă în plugin (și identic în
 *    android.config / ios.config dacă există acolo). Fără cheie, harta nativă
 *    nu se afișează deloc (GoogleMapPicker arată mesajul de cheie lipsă).
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
const raw = readFileSync(join(here, '..', 'app.json'), 'utf8');
const appJson = JSON.parse(raw) as AppJson;
const plugins = appJson.expo.plugins ?? [];
const maps = plugins.find((p) => (typeof p === 'string' ? p : p[0]) === 'react-native-maps');

assert(!raw.includes('REPLACE_WITH_YOUR_GOOGLE_MAPS_KEY'), 'fără cheie Maps placeholder în app.json');
assert(maps !== undefined, 'react-native-maps e în plugins');

const props = typeof maps === 'string' || !maps ? {} : maps[1];
const androidKey = appJson.expo.android?.config?.googleMaps?.apiKey;
const iosKey = appJson.expo.ios?.config?.googleMapsApiKey;
if (androidKey) {
  assert(props.androidGoogleMapsApiKey === androidKey, 'cheia android din plugin = cea din android.config');
}
if (iosKey) {
  assert(props.iosGoogleMapsApiKey === iosKey, 'cheia iOS din plugin = cea din ios.config');
}
for (const k of ['androidGoogleMapsApiKey', 'iosGoogleMapsApiKey']) {
  if (props[k] !== undefined) {
    assert(typeof props[k] === 'string' && (props[k] as string).length > 10, `pluginul maps: ${k} valid`);
  }
}

console.log(`appConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
