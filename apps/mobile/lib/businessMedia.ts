import { Platform } from 'react-native';

import { deletePublicMedia, uploadPublicMedia } from '@/lib/mediaUpload';
import { readLocalImageBytes } from '@/lib/uploadLocalImage';

/** Bucket public al copertei + galeriei firmei (migrarea v60). */
export const BUSINESS_MEDIA_BUCKET = 'business-media' as const;
/** Lățimi maxime pe web (canvas): coperta 1600px, galeria 1200px. Pe telefon nu se aplică. */
export const COVER_MAX_WIDTH = 1600;
export const GALLERY_MAX_WIDTH = 1200;

/**
 * Micșorează poza locală și o urcă în folderul firmei (<business_id>/...).
 * Fără module native noi (aplicația instalată nu le are): pe web redimensionare
 * pe canvas (JPEG 80%), pe telefon citim fișierul dat de expo-image-picker
 * (apelat cu quality 0.8), fără micșorarea lățimii; limita rămâne cea a bucketului (5 MB).
 * Întoarce URL-ul public.
 */
export async function uploadBusinessMediaImage(
  localUri: string,
  businessId: string,
  opts: { maxWidth: number; sourceWidth?: number | null }
): Promise<string> {
  const buffer =
    Platform.OS === 'web'
      ? await resizeImageOnWeb(localUri, opts.maxWidth)
      : (await readLocalImageBytes(localUri)).buffer;
  return uploadPublicMedia(BUSINESS_MEDIA_BUCKET, businessId, 'jpg', buffer, 'image/jpeg');
}

/** Redimensionare pe canvas (doar web): lățime maximă, re-encodare JPEG 80%. */
async function resizeImageOnWeb(localUri: string, maxWidth: number): Promise<ArrayBuffer> {
  const source = await (await fetch(localUri)).blob();
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return source.arrayBuffer();
  }
  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImage(objectUrl);
    const scale = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source.arrayBuffer();
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8)
    );
    return blob ? blob.arrayBuffer() : source.arrayBuffer();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}

/** Șterge fișierul din storage (best-effort: nu aruncă, URL-ul dispărut din DB contează). */
export async function deleteBusinessMediaImage(publicUrl: string): Promise<void> {
  await deletePublicMedia(BUSINESS_MEDIA_BUCKET, publicUrl);
}
