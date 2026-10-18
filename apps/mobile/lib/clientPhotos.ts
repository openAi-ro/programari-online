import { supabase } from '@/lib/supabase';
import type { ClientPhoto } from '@/lib/types';

/** Bucket PRIVAT pentru pozele înainte/după ale clienților (v53). */
export const CLIENT_PHOTO_BUCKET = 'client-photos';

/** Cât e valabil linkul semnat de afișare (secunde). */
const SIGNED_URL_TTL = 60 * 60;

/** Calea în bucket: {business}/{client}/{fișier} — RLS citește business-ul și clientul din ea. */
export function clientPhotoPath(businessId: string, clientUserId: string, ext: string): string {
  return `${businessId}/${clientUserId}/${Date.now()}.${ext}`;
}

/** Pune pe fiecare poză un link semnat temporar (bucket-ul nu are linkuri publice). */
export async function withSignedUrls(photos: ClientPhoto[]): Promise<ClientPhoto[]> {
  if (photos.length === 0) return photos;
  const { data } = await supabase.storage
    .from(CLIENT_PHOTO_BUCKET)
    .createSignedUrls(
      photos.map((p) => p.storage_path),
      SIGNED_URL_TTL
    );
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return photos.map((p) => ({ ...p, signedUrl: byPath.get(p.storage_path) ?? null }));
}
