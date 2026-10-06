/** Generează lib/leafletBundle.ts din pachetul leaflet instalat (JS + CSS inline).
 * Run: node scripts/inline-leaflet.mjs  (din apps/mobile)
 * Harta din WebView pornește și fără internet — fără dependență de CDN.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'node_modules', 'leaflet', 'dist');
const js = readFileSync(join(dist, 'leaflet.js'), 'utf8');
const css = readFileSync(join(dist, 'leaflet.css'), 'utf8');

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

const out = `/** GENERAT de scripts/inline-leaflet.mjs — nu edita manual. Re rulează scriptul la upgrade leaflet. */
export const LEAFLET_VERSION_BUNDLED = '1.9.4';
export const LEAFLET_JS = \`${esc(js)}\`;
export const LEAFLET_CSS = \`${esc(css)}\`;
`;
writeFileSync(join(root, 'lib', 'leafletBundle.ts'), out);
console.log(`leafletBundle.ts: js=${js.length} css=${css.length}`);
