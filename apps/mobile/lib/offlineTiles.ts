import { Directory, File, Paths } from 'expo-file-system';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  PACK_DIR_NAME,
  RO_BBOX,
  packTileCount,
  tileRangeForBbox,
  tileRelPath,
  tileUrl,
} from './offlineTilesMath';

export {
  MAX_ZOOM,
  MIN_ZOOM,
  PACK_DIR_NAME,
  RO_BBOX,
  packTileCount,
  tileRelPath,
  tileUrl,
};

/**
 * Pachet offline de fundal hartă (România, raster OSM z6–z9).
 * Descărcat o singură dată (ideal pe WiFi), apoi harta din ecranul
 * Hartă citește dalele local-first, cu fallback online.
 * Producție: înlocuiți TILE_URL cu serverul propriu de dale.
 */

/** Pauză între cereri (ms) — politete față de serverul public de dale. */
const FETCH_DELAY_MS = 250;

export function packDir(): Directory {
  return new Directory(Paths.document, PACK_DIR_NAME);
}

function ensureDir(dir: Directory): void {
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
}

export type PackStatus = { total: number; cached: number; bytes: number };

export function getPackStatus(): PackStatus {
  const root = packDir();
  const total = packTileCount();
  if (!root.exists) return { total, cached: 0, bytes: 0 };
  let cached = 0;
  let bytes = 0;
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
    const r = tileRangeForBbox(RO_BBOX, z);
    for (let x = r.xMin; x <= r.xMax; x += 1) {
      for (let y = r.yMin; y <= r.yMax; y += 1) {
        const f = new File(root, `${z}/${x}/${y}.png`);
        if (f.exists) {
          cached += 1;
          try {
            bytes += f.size ?? 0;
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  return { total, cached, bytes };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type DownloadCallbacks = {
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
};

/** Descarcă secvențial dalele lipsă. Sare peste cele deja existente. */
export async function downloadPack(cb: DownloadCallbacks = {}): Promise<PackStatus> {
  const root = packDir();
  ensureDir(root);
  const total = packTileCount();
  // Contorizăm și dalele deja existente ca progres.
  let done = getPackStatus().cached;
  cb.onProgress?.(done, total);
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
    const r = tileRangeForBbox(RO_BBOX, z);
    for (let x = r.xMin; x <= r.xMax; x += 1) {
      for (let y = r.yMin; y <= r.yMax; y += 1) {
        if (cb.shouldCancel?.()) return getPackStatus();
        const dir = new Directory(root, `${z}/${x}`);
        const file = new File(dir, `${y}.png`);
        if (!file.exists) {
          try {
            ensureDir(dir);
            await File.downloadFileAsync(tileUrl(z, x, y), file, { idempotent: true });
          } catch {
            // Dală indisponibilă (offline / 404) — rămâne fallbackul online.
          }
          await delay(FETCH_DELAY_MS);
        }
        done += 1;
        if (done % 5 === 0 || done === total) cb.onProgress?.(done, total);
      }
    }
  }
  return getPackStatus();
}

export function deletePack(): void {
  const root = packDir();
  if (root.exists) root.delete();
}
