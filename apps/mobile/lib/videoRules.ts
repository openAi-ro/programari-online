/** Reguli pure pentru video-ul de prezentare — testabile în node. */
import { trKey } from './i18n';

export const PROMO_VIDEO_BUCKET = 'business-videos';
export const PROMO_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const PROMO_VIDEO_MAX_SECONDS = 90;

const ALLOWED_EXT = new Set(['mp4', 'mov', 'webm']);

/** Mapare tip MIME (raportat de picker) → extensie acceptată. */
const MIME_TO_EXT: Record<string, 'mp4' | 'mov' | 'webm'> = {
  'video/mp4': 'mp4',
  'video/m4v': 'mp4',
  'video/x-m4v': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export type VideoAssetInfo = {
  sizeBytes: number | null;
  /** Durata în MILISECUNDE (așa o raportează pickerul nativ). */
  durationMs: number | null;
  extension: string | null;
};

/** Mesaj de eroare localizat sau null dacă assetul e acceptat. */
export function validatePromoVideoAsset(asset: VideoAssetInfo): string | null {
  const ext = (asset.extension ?? '').toLowerCase();
  if (!ext || !ALLOWED_EXT.has(ext)) {
    const received = asset.extension ? trKey('media.receivedFormat', { ext: asset.extension }) : '';
    return trKey('media.videoBadFormat', { received });
  }
  if (asset.sizeBytes != null && asset.sizeBytes > PROMO_VIDEO_MAX_BYTES) {
    return trKey('media.videoTooBig');
  }
  if (
    asset.durationMs != null &&
    asset.durationMs > PROMO_VIDEO_MAX_SECONDS * 1000
  ) {
    return trKey('media.videoTooLong');
  }
  return null;
}

/**
 * Normalizează durata brută din expo-image-picker la milisecunde.
 * Nativ (Android/iOS): milisecunde (MediaMetadataRetriever / AVAsset).
 * Web: secunde (HTMLVideoElement.duration).
 */
export function pickerDurationToMs(
  raw: number | null | undefined,
  platform: string
): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
  if (platform === 'web') return Math.round(raw * 1000);
  return Math.round(raw);
}

/** Extensia din URI local (`file://.../clip.MP4` → `mp4`), null dacă lipsește. */
export function videoExtensionFromUri(localUri: string): string | null {
  const clean = (localUri.split('?')[0] ?? localUri).trim();
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const fileName = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return null;
  const ext = fileName.slice(dot + 1).toLowerCase().trim();
  return ext ? ext : null;
}

/**
 * Extensia din tipul MIME raportat de picker (`video/mp4` → `mp4`).
 * Mai de încredere decât URI-ul: filmările pot veni ca `content://...`
 * fără extensie sau cu extensii ciudate de dispozitiv.
 */
export function videoExtensionFromMimeType(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  return MIME_TO_EXT[mimeType.toLowerCase().trim()] ?? null;
}

/**
 * Rezolvă extensia video: mai întâi MIME (sigur), apoi URI (fallback).
 * Întoarce și sursa, ca mesajele de eroare să arate ce s-a primit.
 */
export function resolveVideoExtension(input: {
  mimeType?: string | null;
  uri: string;
}): { extension: string | null; from: 'mime' | 'uri' | 'none' } {
  const fromMime = videoExtensionFromMimeType(input.mimeType);
  if (fromMime) return { extension: fromMime, from: 'mime' };
  const fromUri = videoExtensionFromUri(input.uri);
  if (fromUri) return { extension: fromUri, from: 'uri' };
  return { extension: null, from: 'none' };
}

/** Content-Type pentru upload, după extensia rezolvată. */
export function videoContentType(extension: string | null): string {
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'webm') return 'video/webm';
  return 'video/mp4';
}
