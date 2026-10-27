import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { supabase, supabaseAnonKey } from '@/lib/supabase';
import { trKey } from '@/lib/i18n';
import { mediaKeyFromUrl, type PublicMediaBucket } from '@/lib/mediaKeys';

/**
 * Cloudflare Worker in front of the R2 buckets (infra/media-worker).
 * Public media: GET <base>/m/<bucket>/<folder>/<file>.
 * Chat files: PUT <base>/c/<conversation>/<file>, read only through signed URLs.
 * The Worker checks each write with the caller's own Supabase session
 * (media_can_write / chat_can_access RPCs), so no extra key lives in the app.
 */
export const MEDIA_BASE_URL = 'https://programari-media.rafaeldanescu.workers.dev';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(trKey('req.notAuthed'));
  return { authorization: `Bearer ${token}`, apikey: supabaseAnonKey };
}

async function workerError(res: Response): Promise<Error> {
  let code = '';
  try {
    code = ((await res.json()) as { error?: string }).error ?? '';
  } catch {
    /* body is not JSON */
  }
  if (res.status === 413) return new Error(trKey('media.uploadTooBig'));
  if (res.status === 415) return new Error(trKey('media.uploadBadType'));
  if (res.status === 401 || res.status === 403) return new Error(trKey('media.uploadForbidden'));
  return new Error(trKey('media.uploadFailed', { code: code || String(res.status) }));
}

function randomPart(): string {
  return Math.floor(Math.random() * 1e6).toString();
}

/** Uploads one public file (logo, avatar, staff photo, cover/gallery, promo video). Returns its public URL. */
export async function uploadPublicMedia(
  bucket: PublicMediaBucket,
  folder: string,
  ext: string,
  body: ArrayBuffer,
  contentType: string
): Promise<string> {
  const key = `${bucket}/${folder}/${Date.now()}-${randomPart()}.${ext}`;
  const res = await fetch(`${MEDIA_BASE_URL}/m/${key}`, {
    method: 'PUT',
    headers: { ...(await authHeaders()), 'content-type': contentType },
    body,
  });
  if (!res.ok) throw await workerError(res);
  return `${MEDIA_BASE_URL}/m/${key}`;
}

/** Deletes a public file we own (best-effort: a stale file must not block the UI). */
export async function deletePublicMedia(bucket: PublicMediaBucket, publicUrl: string): Promise<void> {
  const key = mediaKeyFromUrl(bucket, publicUrl);
  if (!key) return;
  try {
    await fetch(`${MEDIA_BASE_URL}/m/${bucket}/${key}`, { method: 'DELETE', headers: await authHeaders() });
  } catch {
    /* best-effort */
  }
}

/** Uploads a chat photo/video into the conversation folder. Returns the stored key. */
export async function uploadChatFile(
  conversationId: string,
  ext: string,
  body: ArrayBuffer,
  contentType: string
): Promise<{ key: string; bytes: number }> {
  const key = `${conversationId}/${Date.now()}-${randomPart()}.${ext}`;
  const res = await fetch(`${MEDIA_BASE_URL}/c/${key}`, {
    method: 'PUT',
    headers: { ...(await authHeaders()), 'content-type': contentType },
    body,
  });
  if (!res.ok) throw await workerError(res);
  return { key, bytes: body.byteLength };
}

/** Short-lived signed URLs for chat files the caller may read (unknown keys are left out). */
export async function signChatFiles(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const res = await fetch(`${MEDIA_BASE_URL}/c-sign`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'content-type': 'application/json' },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { urls?: Record<string, string> };
  return data.urls ?? {};
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Reads a picked file (photo or video) into memory.
 * Web: the picker gives a blob:/data: URI. Native: copy to cache and read with
 * expo-file-system, because fetch(content://) on Android can return a 14-byte error text.
 */
export async function readLocalFileBytes(localUri: string, ext: string): Promise<ArrayBuffer> {
  let buffer: ArrayBuffer;
  if (Platform.OS === 'web') {
    buffer = await (await fetch(localUri)).arrayBuffer();
  } else {
    const cacheRoot = FileSystem.cacheDirectory;
    if (!cacheRoot) throw new Error(trKey('media.cacheUnavailable'));
    const dest = `${cacheRoot}upload-${Date.now()}.${ext}`;
    try {
      await FileSystem.copyAsync({ from: localUri, to: dest });
    } catch {
      /* some picker URIs are readable directly */
    }
    try {
      const base64 = await FileSystem.readAsStringAsync(dest, { encoding: 'base64' }).catch(() =>
        FileSystem.readAsStringAsync(localUri, { encoding: 'base64' })
      );
      buffer = base64ToArrayBuffer(base64);
    } catch {
      throw new Error(trKey('media.fileUnreadable'));
    } finally {
      try {
        await FileSystem.deleteAsync(dest, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }
  if (buffer.byteLength < 100) throw new Error(trKey('media.fileEmpty'));
  return buffer;
}
