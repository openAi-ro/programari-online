import { deletePublicMedia, uploadPublicMedia } from '@/lib/mediaUpload';
import { IMAGE_MAX_SIDE } from '@/lib/imageSizing';
import { readLocalImageBytes } from '@/lib/uploadLocalImage';

/** Bucket public al copertei + galeriei firmei (migrarea v60). */
export const BUSINESS_MEDIA_BUCKET = 'business-media' as const;

/**
 * Micșorează poza locală (max 1200px, WebP pe web) și o urcă în folderul firmei (<business_id>/...).
 * Întoarce URL-ul public.
 */
export async function uploadBusinessMediaImage(localUri: string, businessId: string): Promise<string> {
  const { buffer, contentType, ext } = await readLocalImageBytes(localUri, IMAGE_MAX_SIDE.photo);
  return uploadPublicMedia(BUSINESS_MEDIA_BUCKET, businessId, ext, buffer, contentType);
}

/** Șterge fișierul din storage (best-effort: nu aruncă, URL-ul dispărut din DB contează). */
export async function deleteBusinessMediaImage(publicUrl: string): Promise<void> {
  await deletePublicMedia(BUSINESS_MEDIA_BUCKET, publicUrl);
}
