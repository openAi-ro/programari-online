import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { trKey } from '@/lib/i18n';
import { readLocalFileBytes, uploadPublicMedia } from '@/lib/mediaUpload';
import {
  PROMO_VIDEO_BUCKET,
  resolveVideoExtension,
  validatePromoVideoAsset,
  videoContentType,
} from '@/lib/videoRules';

async function localFileSize(localUri: string): Promise<number | null> {
  if (Platform.OS === 'web') return null;
  const info = await FileSystem.getInfoAsync(localUri);
  return info.exists && 'size' in info && typeof info.size === 'number' ? info.size : null;
}

/**
 * Încarcă video-ul de prezentare (R2, prin Worker) și întoarce URL-ul public.
 * Aruncă Error cu mesaj localizat (afișabil direct în UI).
 */
export async function uploadBusinessVideo(
  localUri: string,
  businessId: string,
  opts?: { durationMs?: number | null; mimeType?: string | null }
): Promise<string> {
  // MIME-ul raportat de picker e mai sigur decât extensia din URI:
  // filmările vin uneori ca content:// fără extensie.
  const { extension: ext } = resolveVideoExtension({ mimeType: opts?.mimeType, uri: localUri });
  const err = validatePromoVideoAsset({
    sizeBytes: await localFileSize(localUri),
    durationMs: opts?.durationMs ?? null,
    extension: ext,
  });
  if (err) throw new Error(err);
  if (!ext) throw new Error(trKey('media.videoFormat'));

  const buffer = await readLocalFileBytes(localUri, ext);
  const sizeErr = validatePromoVideoAsset({ sizeBytes: buffer.byteLength, durationMs: null, extension: ext });
  if (sizeErr) throw new Error(sizeErr);
  return uploadPublicMedia(PROMO_VIDEO_BUCKET, businessId, ext, buffer, videoContentType(ext));
}
