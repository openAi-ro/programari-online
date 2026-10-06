import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';
import {
  PROMO_VIDEO_BUCKET,
  resolveVideoExtension,
  validatePromoVideoAsset,
  videoContentType,
} from '@/lib/videoRules';

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Încarcă video-ul de prezentare în storage și întoarce URL-ul public.
 * Aruncă Error cu mesaj în română (afișabil direct în UI).
 */
export async function uploadBusinessVideo(
  localUri: string,
  businessId: string,
  opts?: { durationMs?: number | null; mimeType?: string | null }
): Promise<string> {
  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) throw new Error('Cache-ul local nu e disponibil pe acest dispozitiv.');

  const info = await FileSystem.getInfoAsync(localUri);
  // MIME-ul raportat de picker e mai sigur decât extensia din URI:
  // filmările vin uneori ca content:// fără extensie.
  const { extension: ext } = resolveVideoExtension({ mimeType: opts?.mimeType, uri: localUri });
  const err = validatePromoVideoAsset({
    sizeBytes:
      info.exists && 'size' in info && typeof info.size === 'number' ? info.size : null,
    durationMs: opts?.durationMs ?? null,
    extension: ext,
  });
  if (err) throw new Error(err);
  if (!ext) throw new Error('Nu am putut determina formatul video-ului.');

  const dest = `${cacheRoot}promo-${Date.now()}.${ext}`;
  try {
    await FileSystem.copyAsync({ from: localUri, to: dest });
  } catch {
    /* unele URI-uri din picker se citesc direct */
  }
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(dest, { encoding: 'base64' }).catch(() =>
      FileSystem.readAsStringAsync(localUri, { encoding: 'base64' })
    );
  } catch {
    throw new Error('Nu am putut citi video-ul de pe telefon. Alege-l din nou din galerie.');
  } finally {
    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
  const buffer = base64ToArrayBuffer(base64);
  if (buffer.byteLength < 100) {
    throw new Error('Video-ul citit e gol. Încearcă alt fișier.');
  }
  const path = `${businessId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(PROMO_VIDEO_BUCKET)
    .upload(path, buffer, { contentType: videoContentType(ext), upsert: true });
  if (upErr) {
    if (/bucket|not found|does not exist/i.test(upErr.message)) {
      throw new Error('Spațiul video lipsește pe server. Aplică migrările (supabase db push) și reîncearcă.');
    }
    throw upErr;
  }
  const { data } = supabase.storage.from(PROMO_VIDEO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
