/**
 * Run: npx tsx lib/offlineTiles.test.ts
 * from apps/mobile
 * (doar matematică pură — fără FileSystem, rulează și în node)
 */
import {
  MAX_ZOOM,
  MIN_ZOOM,
  RO_BBOX,
  lonLatToTile,
  packTileCount,
  tileRangeForBbox,
  tileRelPath,
  tileUrl,
} from './offlineTilesMath';
import { LEAFLET_CSS, LEAFLET_JS, LEAFLET_VERSION_BUNDLED } from './leafletBundle';

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

// București (26.10, 44.43) la z9 — valoare din formula standard slippy-map.
const b = lonLatToTile(26.1025, 44.4268, 9);
assert(b.x === 293 && b.y === 185, 'dala București z9', `got ${b.x}/${b.y}`);

// Dala București e în intervalul României la z9.
const r9 = tileRangeForBbox(RO_BBOX, 9);
assert(b.x >= r9.xMin && b.x <= r9.xMax, 'București x în range RO z9');
assert(b.y >= r9.yMin && b.y <= r9.yMax, 'București y în range RO z9');

// Intervalele sunt ordonate și nevide pe toate zoomurile.
for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
  const r = tileRangeForBbox(RO_BBOX, z);
  assert(r.xMin <= r.xMax && r.yMin <= r.yMax, `range nevid z${z}`);
}

// Număr total rezonabil pentru z6–z9 (ordinul sutelor, nu zeci de mii).
const total = packTileCount();
assert(total > 200 && total < 5000, 'total dale rezonabil', `got ${total}`);

// Format URL + cale relativă.
assert(tileUrl(9, 293, 189) === 'https://tile.openstreetmap.org/9/293/189.png', 'format tileUrl');
assert(
  tileRelPath(9, 293, 189) === 'offline-tiles-ro/9/293/189.png',
  'format tileRelPath'
);

// Bundle Leaflet inline: pornește harta fără CDN (critic pentru offline/Expo Go).
assert(LEAFLET_VERSION_BUNDLED === '1.9.4', 'versiune bundle Leaflet');
assert(LEAFLET_JS.length > 100000, 'bundle JS nevid', `got ${LEAFLET_JS.length}`);
assert(LEAFLET_CSS.length > 10000, 'bundle CSS nevid', `got ${LEAFLET_CSS.length}`);
assert(!LEAFLET_JS.includes('</script'), 'bundle JS fără </script> (sigur de inline)');

console.log(`offlineTiles: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
